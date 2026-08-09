import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app";

describe("HTTP application", () => {
  it("reports liveness, database readiness, and demo status", async () => {
    const app = await createApp({ serveClient: false });
    await request(app).get("/livez").expect(200, { ok: true });
    const ready = await request(app).get("/readyz").expect(200);
    expect(ready.body).toMatchObject({ ok: true, database: true });
    const status = await request(app).get("/api/status").expect(200);
    expect(status.body).toMatchObject({ account: null, overlay: null });
    expect(status.headers["cache-control"]).toBe("no-store");
  });

  it("does not disclose whether a random overlay key exists through errors", async () => {
    const app = await createApp({ serveClient: false });
    await request(app).get("/api/overlay/not-a-real-secret").expect(404, {
      error: "Overlay not found",
    });
  });

  it("requires authentication and rejects cross-origin mutations", async () => {
    const app = await createApp({ serveClient: false });
    await request(app).put("/api/settings").send({}).expect(401, {
      error: "Authentication required",
    });
    await request(app)
      .post("/api/logout")
      .set("Origin", "https://malicious.example")
      .expect(403, { error: "Invalid origin" });
  });

  it("returns bounded JSON errors instead of accepting oversized input", async () => {
    const app = await createApp({ serveClient: false });
    const response = await request(app)
      .put("/api/settings")
      .set("Content-Type", "application/json")
      .send({ value: "x".repeat(40_000) })
      .expect(413);
    expect(response.headers["cache-control"]).toBe("no-store");
  });
});
