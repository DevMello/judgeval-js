import type { Example } from "./Example";

/**
 * A single judge's result for one example, parsed from the current
 * experiments payload (rows keyed `judge_name` with typed values).
 * Mirrors the Python SDK's `ScorerData`.
 */
export interface ScorerData {
  /** Judge name, or `null` if the row did not carry one. */
  name: string | null;
  /**
   * The scorer's value: a number for numeric scorers, `"Yes"`/`"No"` for
   * binary scorers, the label for categorical scorers, or `null`.
   */
  value: string | number | null;
  /** Score type reported by the server (e.g. "numeric", "binary"). */
  scoreType: string | null;
  /** Server-reported success flag, or `null` when not applicable. */
  success: boolean | null;
  /** Error message if the scorer failed, else `null`. */
  error: string | null;
  /** Model used to evaluate, when reported. */
  evaluationModel: string | null;
  /** Judge-supplied metadata (e.g. reasoning), defaults to `{}`. */
  additionalMetadata: Record<string, unknown>;
  /** Server-side scorer data id, when reported. */
  id: string | null;
  /** Lower bound of the score range. Defaults to `0`. */
  minimumScoreRange: number;
  /** Upper bound of the score range. Defaults to `1`. */
  maximumScoreRange: number;
}

/** The combined result of running scorers against a single example. */
export interface ScoringResult {
  /** Per-scorer results parsed from the API payload. */
  scorersData: ScorerData[];
  /** The original example that was evaluated. */
  example: Example;
}
