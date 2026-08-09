import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import net from "node:net";
import WebSocket from "ws";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { OverlayEvent } from "../../shared/events";
import { TwitchChat } from "../../server/twitch";

const cli = process.env.TWITCH_CLI_BIN ?? "twitch";
let cliServer: ChildProcess | undefined;
let port = 0;
let cliOutput = "";

beforeAll(async () => {
  const version = spawnSync(cli, ["version"], { encoding: "utf8" });
  if (version.error || version.status !== 0)
    throw new Error(
      "Twitch CLI is required. Install it or set TWITCH_CLI_BIN to its executable path.",
    );

  port = await availablePort();
  cliServer = spawn(
    cli,
    [
      "event",
      "websocket",
      "start-server",
      "--ip",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  cliServer.stdout?.on("data", (chunk) => (cliOutput += chunk.toString()));
  cliServer.stderr?.on("data", (chunk) => (cliOutput += chunk.toString()));
  await waitForPort(port, cliServer);
});

afterAll(async () => {
  if (!cliServer || cliServer.exitCode !== null) return;
  cliServer.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => cliServer?.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 2_000)),
  ]);
  if (cliServer.exitCode === null) cliServer.kill("SIGKILL");
});

describe("Twitch CLI EventSub transport", () => {
  it("recovers from a close and carries state across a CLI reconnect", async () => {
    const events: OverlayEvent[] = [];
    const sockets: WebSocket[] = [];
    const subscriptionBodies: Array<Record<string, unknown>> = [];
    const initialUrl = `ws://127.0.0.1:${port}/ws`;
    const chat = new TwitchChat("42", {
      createSocket: (url) => {
        const target = url.startsWith("wss://eventsub.wss.twitch.tv")
          ? initialUrl
          : url.replace("localhost", "127.0.0.1");
        const socket = new WebSocket(target);
        sockets.push(socket);
        return socket;
      },
      accessToken: async () => "integration-token",
      authorizationLost: () => undefined,
      random: () => 0,
      fetch: async (input, init) => {
        const url = String(input);
        if (url.endsWith("/helix/eventsub/subscriptions")) {
          subscriptionBodies.push(
            JSON.parse(String(init?.body)) as Record<string, unknown>,
          );
          return new Response(null, { status: 202 });
        }
        if (url.includes("/helix/chat/badges"))
          return Response.json({ data: [] });
        throw new Error(`Unexpected integration HTTP request: ${url}`);
      },
    });

    const firstConnected = waitForEvent(
      events,
      (event) => event.kind === "state" && event.state === "connected",
    );
    const unsubscribe = chat.subscribe((event) => events.push(event));
    try {
      await firstConnected;
      expect(subscriptionBodies).toHaveLength(5);
      expect(subscriptionBodies.map((body) => body.type)).toEqual([
        "channel.chat.message",
        "channel.chat.notification",
        "channel.chat.message_delete",
        "channel.chat.clear_user_messages",
        "channel.chat.clear",
      ]);
      for (const body of subscriptionBodies)
        expect(body).toMatchObject({
          version: "1",
          condition: { broadcaster_user_id: "42", user_id: "42" },
          transport: { method: "websocket" },
        });
      const sessionIds = new Set(
        subscriptionBodies.map(
          (body) =>
            (body.transport as { session_id?: string } | undefined)?.session_id,
        ),
      );
      expect(sessionIds.size).toBe(1);
      const sessionId = [...sessionIds][0];
      expect(sessionId).toBeTruthy();

      const recovered = waitForEvent(
        events,
        (event) =>
          event.kind === "state" &&
          event.state === "connected" &&
          sockets.length >= 2 &&
          subscriptionBodies.length === 10,
      );
      const close = spawnSync(
        cli,
        [
          "event",
          "websocket",
          "close",
          "--session",
          String(sessionId),
          "--reason",
          "4006",
          "--ip",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        { encoding: "utf8", timeout: 10_000 },
      );
      expect(
        close.status,
        close.stderr || close.stdout || "Twitch CLI close failed",
      ).toBe(0);
      await recovered;

      expect(sockets).toHaveLength(2);
      await waitUntil(() => sockets[0].readyState === WebSocket.CLOSED);
      expect(subscriptionBodies).toHaveLength(10);

      const reconnected = waitForEvent(
        events,
        (event) =>
          event.kind === "state" &&
          event.state === "connected" &&
          sockets.length >= 3,
      );
      const reconnect = spawnSync(
        cli,
        [
          "event",
          "websocket",
          "reconnect",
          "--ip",
          "127.0.0.1",
          "--port",
          String(port),
        ],
        { encoding: "utf8", timeout: 10_000 },
      );
      expect(
        reconnect.status,
        reconnect.stderr || reconnect.stdout || "Twitch CLI reconnect failed",
      ).toBe(0);
      await reconnected;

      expect(sockets).toHaveLength(3);
      await waitUntil(() => sockets[1].readyState === WebSocket.CLOSED);
      expect(subscriptionBodies).toHaveLength(10);
    } finally {
      unsubscribe();
      chat.stop();
    }
  });
});

function availablePort() {
  return new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Unable to allocate a Twitch CLI test port"));
        return;
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)));
    });
  });
}

async function waitForPort(targetPort: number, process: ChildProcess) {
  await waitUntil(
    () =>
      new Promise<boolean>((resolve, reject) => {
        if (process.exitCode !== null) {
          reject(
            new Error(
              `Twitch CLI server exited (${process.exitCode}).\n${cliOutput}`,
            ),
          );
          return;
        }
        const socket = net.connect(targetPort, "127.0.0.1");
        socket.once("connect", () => {
          socket.destroy();
          resolve(true);
        });
        socket.once("error", () => resolve(false));
      }),
  );
}

async function waitForEvent(
  events: OverlayEvent[],
  predicate: (event: OverlayEvent) => boolean,
) {
  await waitUntil(() => events.some(predicate));
}

async function waitUntil(check: () => boolean | Promise<boolean>) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `Timed out waiting for Twitch CLI protocol state.\n${cliOutput}`,
  );
}
