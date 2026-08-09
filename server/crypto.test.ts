import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptWithKey, encryptWithKey, hashToken } from "./crypto";

describe("credential encryption", () => {
  it("round-trips with authenticated encryption and a random nonce", () => {
    const key = randomBytes(32);
    const first = encryptWithKey("secret", key);
    const second = encryptWithKey("secret", key);
    expect(first).not.toEqual(second);
    expect(decryptWithKey(first, key)).toBe("secret");
  });

  it("rejects tampering and wrong key sizes", () => {
    const key = randomBytes(32);
    const encrypted = encryptWithKey("secret", key);
    expect(() => decryptWithKey(`${encrypted.slice(0, -1)}x`, key)).toThrow();
    expect(() => encryptWithKey("secret", randomBytes(16))).toThrow();
  });

  it("hashes opaque session values deterministically", () => {
    expect(hashToken("one")).toBe(hashToken("one"));
    expect(hashToken("one")).not.toBe(hashToken("two"));
  });
});
