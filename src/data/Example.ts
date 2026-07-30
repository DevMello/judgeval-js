import type { Example as APIExample } from "../internal/api/models/Example";

/**
 * The wire format for examples: the fixed API fields plus arbitrary
 * user-defined properties (input, actual_output, etc.).
 */
export type ExampleDict = APIExample & Record<string, unknown>;

/**
 * A single evaluation example with flexible key-value properties.
 *
 * Use `Example.create()` to construct an example with arbitrary fields
 * such as `input`, `actualOutput`, `expectedOutput`, etc.
 *
 * @example
 * ```typescript
 * const example = Example.create({
 *   input: "What is the capital of France?",
 *   actual_output: "Paris is the capital of France.",
 *   expected_output: "Paris",
 * });
 *
 * example.get("input"); // "What is the capital of France?"
 * ```
 */
export class Example {
  readonly exampleId: string;
  readonly createdAt: string;
  readonly name: string | null;
  private readonly _properties: Record<string, unknown>;

  private constructor(
    exampleId: string,
    createdAt: string,
    name: string | null,
    properties: Record<string, unknown>,
  ) {
    this.exampleId = exampleId;
    this.createdAt = createdAt;
    this.name = name;
    this._properties = properties;
  }

  /**
   * Create an example with the given properties.
   *
   * Any key-value pairs passed in `props` become accessible via `.get()`.
   * Common keys: `input`, `actual_output`, `expected_output`, `retrieval_context`.
   *
   * @param props - The example's custom properties.
   * @param name - Optional example name.
   */
  static create(
    props: Record<string, unknown> = {},
    name: string | null = null,
  ): Example {
    return new Example(crypto.randomUUID(), new Date().toISOString(), name, {
      ...props,
    });
  }

  /** Known keys on the API Example interface that are not user properties. */
  private static readonly META_KEYS = new Set([
    "example_id",
    "created_at",
    "name",
    "trace_id",
    "span_id",
    "offline_trace_id",
    "agent_offline_trace_id",
  ]);

  /**
   * Reconstruct an Example from an API response dict.
   *
   * Separates the fixed metadata fields (`example_id`, `created_at`, `name`)
   * from user-defined properties.
   */
  static from(data: ExampleDict): Example {
    const properties: Record<string, unknown> = {};
    for (const key of Object.keys(data)) {
      if (!Example.META_KEYS.has(key)) {
        properties[key] = (data as Record<string, unknown>)[key];
      }
    }
    return new Example(
      data.example_id ?? "",
      data.created_at ?? "",
      data.name ?? null,
      properties,
    );
  }

  /**
   * Build an `Example` from a server dataset entry payload.
   *
   * The server returns dataset examples as `{example_id, created_at, data,
   * offline_trace_id, ...}` with the user fields nested under `data`; older
   * payloads carry the fields at the top level. Unlike {@link from}, every
   * data key becomes a property (unfiltered), and an entry-level
   * `offline_trace_id` is preserved so trace-linked datasets round-trip.
   */
  static fromDatasetEntry(entry: Record<string, unknown>): Example {
    let data = entry.data;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      data = Object.fromEntries(
        Object.entries(entry).filter(
          ([key]) => !["example_id", "created_at", "name"].includes(key),
        ),
      );
    }
    const properties: Record<string, unknown> = {
      ...(data as Record<string, unknown>),
    };
    const offlineTraceId = entry.offline_trace_id;
    if (offlineTraceId && !("offline_trace_id" in properties)) {
      properties.offline_trace_id = offlineTraceId;
    }
    return new Example(
      typeof entry.example_id === "string" ? entry.example_id : "",
      typeof entry.created_at === "string" ? entry.created_at : "",
      typeof entry.name === "string" ? entry.name : null,
      properties,
    );
  }

  /**
   * Serialize to the dataset example payload shape: `example_id` and
   * `created_at` at the top level plus the custom properties — without
   * the `name` field, which dataset schemas do not declare.
   */
  toDatasetEntry(): Record<string, unknown> {
    return {
      example_id: this.exampleId,
      created_at: this.createdAt,
      ...this._properties,
    };
  }

  /** Get a property by key. */
  get(key: string): unknown {
    return this._properties[key];
  }

  /** Check if a property key exists. */
  has(key: string): boolean {
    return key in this._properties;
  }

  /** Return a shallow copy of all custom properties. */
  get properties(): Record<string, unknown> {
    return { ...this._properties };
  }

  /** Serialize to the API wire format. */
  toJSON(): ExampleDict {
    const result: Record<string, unknown> = {
      example_id: this.exampleId,
      created_at: this.createdAt,
      name: this.name,
    };
    for (const [key, value] of Object.entries(this._properties)) {
      result[key] = value;
    }
    // result satisfies ExampleDict structurally — example_id and created_at
    // are always present strings, plus arbitrary extra keys.
    return result as ExampleDict;
  }
}
