import { afterEach, describe, expect, test } from "bun:test";
import { JudgmentAPIError, JudgmentApiClient } from "./client";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

function captureFetch(response: Response): { request: () => Request } {
  let request: Request | undefined;
  globalThis.fetch = ((input, init) => {
    request =
      input instanceof Request
        ? input
        : new Request(input instanceof URL ? input.toString() : input, init);
    return Promise.resolve(response);
  }) as typeof fetch;
  return {
    request: () => {
      if (!request) throw new Error("fetch was not called");
      return request;
    },
  };
}

describe("JudgmentApiClient", () => {
  test("normalizes a trailing slash in the base URL", async () => {
    const capture = captureFetch(
      new Response(JSON.stringify({ project_id: "p-1" }), { status: 200 }),
    );
    const client = new JudgmentApiClient(
      "https://api.example.com/",
      "key",
      "org",
    );
    expect(client.getBaseUrl()).toBe("https://api.example.com");
    await client.postV1projectsResolve({ project_name: "demo" });
    expect(capture.request().url).toBe(
      "https://api.example.com/v1/projects/resolve/",
    );
  });

  test("attaches a timeout signal to every request", async () => {
    let init: RequestInit | undefined;
    globalThis.fetch = ((_input, requestInit) => {
      init = requestInit;
      return Promise.resolve(new Response("{}", { status: 200 }));
    }) as typeof fetch;
    const client = new JudgmentApiClient("https://api.example.com", "k", "o");
    await client.postV1projectsResolve({ project_name: "demo" });
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  test("throws JudgmentAPIError with the body's detail field", async () => {
    captureFetch(
      new Response(JSON.stringify({ detail: "Project not found." }), {
        status: 404,
      }),
    );
    const client = new JudgmentApiClient("https://api.example.com", "k", "o");
    try {
      await client.postV1projectsResolve({ project_name: "missing" });
      throw new Error("expected request to fail");
    } catch (error) {
      expect(error).toBeInstanceOf(JudgmentAPIError);
      expect((error as JudgmentAPIError).status).toBe(404);
      expect((error as JudgmentAPIError).detail).toBe("Project not found.");
      expect((error as JudgmentAPIError).message).toBe(
        "HTTP 404: Project not found.",
      );
    }
  });

  test("falls back through message/error keys and raw text", async () => {
    captureFetch(
      new Response(JSON.stringify({ message: "Slow down." }), { status: 429 }),
    );
    const client = new JudgmentApiClient("https://api.example.com", "k", "o");
    await expect(
      client.postV1projectsResolve({ project_name: "x" }),
    ).rejects.toMatchObject({ status: 429, detail: "Slow down." });

    captureFetch(new Response("<html>gateway error</html>", { status: 502 }));
    await expect(
      client.postV1projectsResolve({ project_name: "x" }),
    ).rejects.toMatchObject({ status: 502, detail: "<html>gateway error</html>" });
  });
});
