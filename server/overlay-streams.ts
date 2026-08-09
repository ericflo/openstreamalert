import type { Response } from "express";
import type { OverlayEvent } from "../shared/events.js";

interface Client {
  response: Response;
  slowWrites: number;
}

class OverlayStreams {
  private clients = new Map<string, Set<Client>>();
  private paused = new Set<string>();
  private total = 0;

  attach(key: string, response: Response) {
    const group = this.clients.get(key) ?? new Set<Client>();
    if (this.total >= 200 || group.size >= 20) return undefined;
    const client = { response, slowWrites: 0 };
    group.add(client);
    this.clients.set(key, group);
    this.total += 1;
    const detach = () => {
      if (!group.delete(client)) return;
      this.total -= 1;
      if (!group.size) this.clients.delete(key);
    };
    return {
      detach,
      send: (event: OverlayEvent) => this.sendEvent(key, client, event),
      comment: (value: string) => this.write(client, `: ${value}\n\n`),
    };
  }

  publish(key: string, event: OverlayEvent) {
    for (const client of this.clients.get(key) ?? [])
      this.sendEvent(key, client, event);
  }

  configure(key: string, enabled: boolean) {
    if (enabled) this.paused.delete(key);
    else this.paused.add(key);
  }

  setEnabled(key: string, enabled: boolean, state?: OverlayEvent) {
    if (enabled) this.paused.delete(key);
    else this.paused.add(key);
    const events: OverlayEvent[] = enabled
      ? state
        ? [state]
        : [{ kind: "state", state: "connecting" }]
      : [{ kind: "clear" }, { kind: "state", state: "paused" }];
    for (const client of this.clients.get(key) ?? [])
      for (const event of events) this.writeEvent(client, event);
  }

  revoke(key?: string) {
    if (!key) return;
    this.paused.delete(key);
    const group = this.clients.get(key);
    if (!group) return;
    for (const client of [...group]) {
      this.write(
        client,
        `data: ${JSON.stringify({ kind: "state", state: "error", detail: "This overlay URL was rotated." })}\n\n`,
      );
      client.response.end();
    }
    this.total -= group.size;
    group.clear();
    this.clients.delete(key);
  }

  count(key?: string) {
    return key ? (this.clients.get(key)?.size ?? 0) : this.total;
  }

  closeAll() {
    for (const key of [...this.clients.keys()]) this.revoke(key);
  }

  private write(client: Client, data: string) {
    if (client.response.writableEnded) return;
    if (client.response.write(data)) {
      client.slowWrites = 0;
    } else if (++client.slowWrites >= 3) {
      client.response.end();
    }
  }

  private sendEvent(key: string, client: Client, event: OverlayEvent) {
    if (
      this.paused.has(key) &&
      event.kind !== "clear" &&
      event.kind !== "settings" &&
      !(event.kind === "state" && event.state === "paused")
    )
      return;
    this.writeEvent(client, event);
  }

  private writeEvent(client: Client, event: OverlayEvent) {
    this.write(client, `data: ${JSON.stringify(event)}\n\n`);
  }
}

export const overlayStreams = new OverlayStreams();
