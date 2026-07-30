import type {
  DiscoveryKind,
  DiscoveryOptions,
  PipelineBuilder,
  QueryBuilder,
} from "./builder";
import { discovery } from "./builder";
import type { PresentationQuery, Query } from "./wire";
import type { components as PublicComponents } from "./generated/public-api";

export interface JqlRequestOptions {
  limit?: number;
  signal?: AbortSignal;
}

type PublicSchemas = PublicComponents["schemas"];
export type JqlQueryResponse = PublicSchemas["PublicJqlQueryResponse"];
export type JqlPresentationResponse =
  PublicSchemas["PublicJqlPresentationResponse"];

export class JudgevalAPIError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly hint = "",
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "JudgevalAPIError";
  }
}

export type JqlQueryInput = Query | QueryBuilder | PipelineBuilder;

function toQuery(input: JqlQueryInput): Query {
  return "toJSON" in input ? input.toJSON() : input;
}

export class JudgevalJqlClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly organizationId: string,
    private readonly projectId: string,
  ) {}

  query(
    query: JqlQueryInput,
    options: JqlRequestOptions = {},
  ): Promise<JqlQueryResponse> {
    return this.post("query", toQuery(query), options);
  }

  present(
    query: PresentationQuery,
    options: JqlRequestOptions = {},
  ): Promise<JqlPresentationResponse> {
    return this.post("query/presentation", query, options);
  }

  discover(
    kind: DiscoveryKind,
    options: DiscoveryOptions & JqlRequestOptions = {},
  ): Promise<JqlQueryResponse> {
    // `limit` is a request-level option only: strip it from the discovery
    // node so the wire payload carries it exactly once (parity with the
    // Python SDK's tested contract).
    const { signal, limit, ...discoveryOptions } = options;
    return this.query(discovery(kind, discoveryOptions), { limit, signal });
  }

  private async post<T>(
    path: string,
    query: Query | PresentationQuery,
    options: JqlRequestOptions,
  ): Promise<T> {
    const response = await fetch(
      `${this.baseUrl.replace(/\/+$/, "")}/v1/projects/${encodeURIComponent(this.projectId)}/${path}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
          "X-Organization-Id": this.organizationId,
        },
        body: JSON.stringify({
          query,
          ...(options.limit === undefined ? {} : { limit: options.limit }),
        }),
        signal: options.signal,
      },
    );
    const text = await response.text();
    if (!response.ok) {
      let payload: {
        detail?: string;
        error?: string;
        message?: string;
        hint?: string;
      } = {};
      try {
        payload = JSON.parse(text) as typeof payload;
      } catch {
        // Preserve the response body below when the server did not return JSON.
      }
      // Tolerate HTTP-date and empty Retry-After values (parity with the
      // Python SDK): only a finite numeric header becomes a seconds value.
      const retryAfter = response.headers.get("Retry-After");
      const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
      throw new JudgevalAPIError(
        response.status,
        payload.error ?? `HTTP_${response.status}`,
        payload.detail ?? payload.message ?? text,
        payload.hint ?? "",
        Number.isFinite(retryAfterSeconds) ? retryAfterSeconds : undefined,
      );
    }
    return JSON.parse(text) as T;
  }
}
