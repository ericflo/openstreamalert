import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithTimeout } from "./http";

afterEach(() => vi.unstubAllGlobals());

describe("HTTP timeouts", () => {
  it("aborts an upstream request when its deadline expires", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_input: string | URL, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener(
              "abort",
              () => reject(init.signal?.reason),
              { once: true },
            );
          }),
      ),
    );

    await expect(
      fetchWithTimeout("https://example.test", {}, 5),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
