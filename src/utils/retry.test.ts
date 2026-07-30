import { describe, expect, test } from "bun:test";
import { retry } from "./retry";

describe("retry", () => {
  test("retries until success", async () => {
    let attempts = 0;
    const result = await retry(
      () => {
        attempts++;
        if (attempts < 3) return Promise.reject(new Error("transient"));
        return Promise.resolve("ok");
      },
      { maxRetries: 3, backoff: () => 0 },
    );
    expect(result).toBe("ok");
    expect(attempts).toBe(3);
  });

  test("throws the last error after exhausting attempts", async () => {
    let attempts = 0;
    await expect(
      retry(
        () => {
          attempts++;
          return Promise.reject(new Error("always"));
        },
        { maxRetries: 2, backoff: () => 0 },
      ),
    ).rejects.toThrow("always");
    expect(attempts).toBe(2);
  });

  test("shouldRetry=false rethrows immediately without further attempts", async () => {
    let attempts = 0;
    await expect(
      retry(
        () => {
          attempts++;
          return Promise.reject(new Error("fatal"));
        },
        {
          maxRetries: 3,
          backoff: () => 0,
          shouldRetry: () => false,
        },
      ),
    ).rejects.toThrow("fatal");
    expect(attempts).toBe(1);
  });

  test("shouldRetry can distinguish errors", async () => {
    let attempts = 0;
    await expect(
      retry(
        () => {
          attempts++;
          return Promise.reject(
            new Error(attempts === 1 ? "transient" : "fatal"),
          );
        },
        {
          maxRetries: 3,
          backoff: () => 0,
          shouldRetry: (error) => (error as Error).message === "transient",
        },
      ),
    ).rejects.toThrow("fatal");
    expect(attempts).toBe(2);
  });
});
