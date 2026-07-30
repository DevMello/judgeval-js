import { describe, expect, test } from "bun:test";
import { Example } from "./Example";

describe("Example.fromDatasetEntry", () => {
  test("unwraps nested data and preserves entry-level offline_trace_id", () => {
    const example = Example.fromDatasetEntry({
      example_id: "ex-1",
      created_at: "2026-01-01T00:00:00.000Z",
      offline_trace_id: "trace-abc",
      data: { input: "hi", expected_output: "hello" },
    });

    expect(example.exampleId).toBe("ex-1");
    expect(example.createdAt).toBe("2026-01-01T00:00:00.000Z");
    expect(example.get("input")).toBe("hi");
    expect(example.get("offline_trace_id")).toBe("trace-abc");
  });

  test("falls back to top-level fields when data is missing", () => {
    const example = Example.fromDatasetEntry({
      example_id: "ex-2",
      created_at: "2026-01-01T00:00:00.000Z",
      input: "top-level",
      name: "ignored-as-property",
    });

    expect(example.get("input")).toBe("top-level");
    expect(example.name).toBe("ignored-as-property");
    expect(example.has("name")).toBe(false);
  });

  test("keeps user columns named like span metadata", () => {
    const example = Example.fromDatasetEntry({
      example_id: "ex-3",
      created_at: "2026-01-01T00:00:00.000Z",
      data: { trace_id: "user-column", input: "x" },
    });

    expect(example.get("trace_id")).toBe("user-column");
  });

  test("does not overwrite a data-level offline_trace_id", () => {
    const example = Example.fromDatasetEntry({
      example_id: "ex-4",
      created_at: "2026-01-01T00:00:00.000Z",
      offline_trace_id: "entry-level",
      data: { offline_trace_id: "data-level" },
    });

    expect(example.get("offline_trace_id")).toBe("data-level");
  });
});

describe("Example.toDatasetEntry", () => {
  test("emits example_id, created_at, and properties without name", () => {
    const example = Example.create({ input: "hi" }, "my-name");
    const entry = example.toDatasetEntry();

    expect(entry.example_id).toBe(example.exampleId);
    expect(entry.created_at).toBe(example.createdAt);
    expect(entry.input).toBe("hi");
    expect("name" in entry).toBe(false);
  });

  test("round-trips offline_trace_id through upload and hydration", () => {
    const original = Example.create({ input: "q", offline_trace_id: "t-1" });
    const rehydrated = Example.fromDatasetEntry({
      ...original.toDatasetEntry(),
      data: undefined,
    });

    expect(rehydrated.get("offline_trace_id")).toBe("t-1");
    expect(rehydrated.get("input")).toBe("q");
  });
});

describe("Example.create", () => {
  test("accepts an optional name and generates fresh ids", () => {
    const a = Example.create({ input: "x" }, "named");
    const b = Example.create({ input: "x" });

    expect(a.name).toBe("named");
    expect(b.name).toBeNull();
    expect(a.exampleId).not.toBe(b.exampleId);
    expect(a.exampleId.length).toBeGreaterThan(0);
  });
});
