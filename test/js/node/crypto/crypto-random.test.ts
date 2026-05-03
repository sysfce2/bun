import { describe, expect, it } from "bun:test";
import { randomBytes, randomInt } from "crypto";
import { bunEnv, bunExe } from "harness";

describe("randomInt args validation", () => {
  it("default min is 0 so max should be greater than 0", () => {
    expect(() => randomInt(-1)).toThrow(RangeError);
    expect(() => randomInt(0)).toThrow(RangeError);
  });
  it("max should be >= min", () => {
    expect(() => randomInt(1, 0)).toThrow(RangeError);
    expect(() => randomInt(10, 5)).toThrow(RangeError);
  });

  it("we allow negative numbers", () => {
    expect(() => randomInt(-2, -1)).not.toThrow(RangeError);
  });

  it("max/min should not be greater than Number.MAX_SAFE_INTEGER or less than Number.MIN_SAFE_INTEGER", () => {
    expect(() => randomInt(Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER - 1, -Number.MAX_SAFE_INTEGER + 1)).toThrow(TypeError);
  });

  it("max - min should be <= 281474976710655", () => {
    expect(() => randomInt(-2, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER)).toThrow(RangeError);
  });

  it("accept large negative numbers", () => {
    expect(() => randomInt(-Number.MAX_SAFE_INTEGER, -Number.MAX_SAFE_INTEGER + 1)).not.toThrow(RangeError);
  });

  it("should return undefined if called with callback", async () => {
    const { resolve, promise } = Promise.withResolvers();

    expect(
      randomInt(1, 2, (err, num) => {
        expect(err).toBeUndefined();
        expect(num).toBe(1);
        resolve();
      }),
    ).toBeUndefined();

    await promise;
  });
});

describe("randomBytes", () => {
  it("error should be null", async () => {
    const { resolve, promise } = Promise.withResolvers();

    randomBytes(10, (err, buf) => {
      expect(err).toBeNull();
      expect(buf).toBeInstanceOf(Buffer);
      resolve();
    });

    await promise;
  });
});

describe("async crypto does not touch a detached ArrayBuffer backing store", () => {
  // Before the fix, the async variants captured a raw pointer into the
  // ArrayBuffer backing store and only `protect()`ed the JS wrapper. Calling
  // `buffer.transfer()` with a different length frees that storage
  // synchronously, so the worker thread would read from / write to freed
  // gigacage memory. These tests spawn a fresh process so that the observed
  // heap reuse isn't perturbed by the test runner itself.

  it("randomFill does not write through a freed backing store", async () => {
    const src = `
      const crypto = require("crypto");
      const iterations = 8;
      const size = 1 << 16;
      const zero = Buffer.alloc(size);
      const keep = [];
      let pending = iterations;
      let corrupted = 0;
      const nonzero = b => Buffer.compare(Buffer.from(b.buffer, b.byteOffset, b.byteLength), zero) !== 0;
      for (let i = 0; i < iterations; i++) {
        const old = new Uint8Array(size);
        crypto.randomFill(old, () => {
          if (--pending === 0) {
            // re-check after the callbacks fire in case the write raced us
            for (const b of keep) if (nonzero(b)) corrupted++;
            process.stdout.write(String(corrupted));
          }
        });
        // detach + free the backing store before the worker runs
        old.buffer.transfer(0);
        // and hand the same-size allocation back out as an all-zero buffer
        const fresh = new Uint8Array(size);
        keep.push(fresh);
        if (nonzero(fresh)) corrupted++;
      }
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("0");
    expect(exitCode).toBe(0);
  });

  it("scrypt copies ArrayBuffer inputs before going off-thread", async () => {
    const src = `
      const crypto = require("crypto");
      const size = 1 << 16;
      const password = new Uint8Array(size).fill(0x41);
      const salt = new Uint8Array(16).fill(0x42);
      const expected = crypto.scryptSync(password, salt, 32).toString("hex");
      crypto.scrypt(password, salt, 32, (err, key) => {
        if (err) throw err;
        process.stdout.write(key.toString("hex") === expected ? "ok" : "mismatch:" + key.toString("hex"));
      });
      // free the password backing store and fill the reused storage with junk
      password.buffer.transfer(0);
      const junk = [];
      for (let i = 0; i < 50; i++) junk.push(new Uint8Array(size).fill(0x43));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok");
    expect(exitCode).toBe(0);
  });

  it("pbkdf2 copies ArrayBuffer inputs before going off-thread", async () => {
    const src = `
      const crypto = require("crypto");
      const size = 1 << 16;
      const password = new Uint8Array(size).fill(0x41);
      const salt = new Uint8Array(16).fill(0x42);
      const expected = crypto.pbkdf2Sync(password, salt, 1000, 32, "sha256").toString("hex");
      crypto.pbkdf2(password, salt, 1000, 32, "sha256", (err, key) => {
        if (err) throw err;
        process.stdout.write(key.toString("hex") === expected ? "ok" : "mismatch:" + key.toString("hex"));
      });
      password.buffer.transfer(0);
      const junk = [];
      for (let i = 0; i < 50; i++) junk.push(new Uint8Array(size).fill(0x43));
    `;
    await using proc = Bun.spawn({
      cmd: [bunExe(), "-e", src],
      env: bunEnv,
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr, exitCode] = await Promise.all([proc.stdout.text(), proc.stderr.text(), proc.exited]);
    expect(stderr).toBe("");
    expect(stdout).toBe("ok");
    expect(exitCode).toBe(0);
  });
});
