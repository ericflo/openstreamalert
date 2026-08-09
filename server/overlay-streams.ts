import type { Response } from "express";
import type { OverlayEvent } from "../shared/events.js";

interface Client {
  response: Response;
  slowWrites: number;
}

class OverlayStreams {
  private clients = new Map<string, Set<Client>>();
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
      send: (event: OverlayEvent) =>
        this.write(client, `data: ${JSON.stringify(event)}\n\n`),
      comment: (value: string) => this.write(client, `: ${value}\n\n`),
    };
  }

  publish(key: string, event: OverlayEvent) {
    for (const client of this.clients.get(key) ?? [])
      this.write(client, `data: ${JSON.stringify(event)}\n\n`);
  }

  revoke(key?: string) {
    if (!key) return;
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
}

export const overlayStreams = new OverlayStreams();
