import { Logger } from "./logger";

export type Serializer = (obj: unknown) => string;

const CIRCULAR = "[Circular]";

/**
 * Recursively convert `value` into a JSON-serializable structure, mirroring
 * the Python SDK's `json_encoder` (utils/serialize.py): BigInt becomes a
 * string, Map becomes a plain object with stringified keys, Set becomes an
 * array, and Error becomes `{name, message}`.
 *
 * Cycle detection tracks the ancestor path only, so shared (diamond)
 * references are preserved and just true cycles collapse to "[Circular]".
 */
function toSerializable(value: unknown, ancestors: Set<object>): unknown {
  if (typeof value === "bigint") return value.toString();
  if (typeof value !== "object" || value === null) return value;
  if (ancestors.has(value)) return CIRCULAR;

  ancestors.add(value);
  try {
    if (typeof (value as { toJSON?: unknown }).toJSON === "function") {
      return toSerializable(
        (value as { toJSON: () => unknown }).toJSON(),
        ancestors,
      );
    }
    if (value instanceof Map) {
      const out: Record<string, unknown> = {};
      for (const [key, entry] of value) {
        out[typeof key === "string" ? key : String(key)] = toSerializable(
          entry,
          ancestors,
        );
      }
      return out;
    }
    if (value instanceof Set) {
      return Array.from(value, (entry) => toSerializable(entry, ancestors));
    }
    if (value instanceof Error) {
      return { name: value.name, message: value.message };
    }
    if (Array.isArray(value)) {
      return value.map((entry) => toSerializable(entry, ancestors));
    }
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = toSerializable(entry, ancestors);
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

export function safeStringify(obj: unknown): string {
  try {
    const result = JSON.stringify(toSerializable(obj, new Set()));
    if (typeof result === "string") return result;
    return String(result);
  } catch (e) {
    Logger.error(`safeStringify failed: ${e}`);
    try {
      return String(obj);
    } catch {
      // String() itself throws for null-prototype objects and revoked proxies.
      return "[Unserializable]";
    }
  }
}

/**
 * Serializes an attribute to an "Attribute" compatible value. Primitives are returned as is, objects are serialized using the provided serializer.
 *
 * @param value - The value to serialize.
 * @param serializer - The serializer to use.
 * @returns A string, number, or boolean value.
 */
export function serializeAttribute(
  value: unknown,
  serializer: Serializer,
): string | number | boolean {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  )
    return value;
  return serializer(value);
}
