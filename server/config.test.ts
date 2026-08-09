import { describe, expect, it } from "vitest";
import { config, parseBindAddress } from "./config";

describe("bind address configuration", () => {
  it("isolates Vitest workers from the persistent application database", () => {
    expect(config.databasePath).toBe(":memory:");
  });

  it("defaults native processes to IPv4 loopback", () => {
    expect(parseBindAddress(undefined)).toBe("127.0.0.1");
    expect(parseBindAddress("")).toBe("127.0.0.1");
  });

  it.each(["localhost", "127.0.0.1", "0.0.0.0", "::1", "::"])(
    "accepts the listen address %s",
    (address) => expect(parseBindAddress(address)).toBe(address),
  );

  it("trims an address copied into the environment", () => {
    expect(parseBindAddress(" 127.0.0.1 ")).toBe("127.0.0.1");
  });

  it.each(["http://127.0.0.1", "127.0.0.1:5173", "local host", "example.com"])(
    "rejects an invalid listen address %s",
    (address) => {
      expect(() => parseBindAddress(address)).toThrow(/BIND_ADDRESS/);
    },
  );
});
