import pc from "picocolors";
import type { JudgmentApiClient } from "../internal/api/client";
import type { ExampleEvaluationRun } from "../internal/api/models/ExampleEvaluationRun";
import type { ExperimentRunItem } from "../internal/api/models/ExperimentRunItem";
import type { Example } from "../data/Example";
import type { ScorerData, ScoringResult } from "../data/ScoringResult";
import type { Judge } from "../judges/Judge";
import { Logger } from "../utils/logger";

const POLL_INTERVAL_MS = 2000;

function binaryLabel(value: boolean): string {
  return value ? "Yes" : "No";
}

/**
 * Extract the display value from a scorer row, honoring `score_type` when
 * present and falling back to whichever typed value the row carries.
 * Port of the Python SDK's `_scorer_value` (evaluation_base.py).
 */
function scorerValue(row: Record<string, unknown>): string | number | null {
  const scoreType = row.score_type;

  if (scoreType === "binary") {
    return typeof row.bool_value === "boolean"
      ? binaryLabel(row.bool_value)
      : null;
  }
  if (scoreType === "categorical") {
    return typeof row.str_value === "string" ? row.str_value : null;
  }
  if (scoreType === "numeric") {
    return typeof row.num_value === "number" ? row.num_value : null;
  }

  if (typeof row.bool_value === "boolean") return binaryLabel(row.bool_value);
  if (typeof row.str_value === "string") return row.str_value;
  if (typeof row.num_value === "number") return row.num_value;
  return null;
}

/**
 * Abstract base for evaluation runners.
 *
 * Provides the shared run -> poll -> display flow.
 * Subclasses implement `_buildPayload` and `_submit` for local vs hosted mode.
 */
export abstract class EvaluatorRunner<S extends string | Judge> {
  protected readonly _client: JudgmentApiClient;
  protected readonly _projectId: string | null;
  protected readonly _projectName: string;

  constructor(
    client: JudgmentApiClient,
    projectId: string | null,
    projectName: string,
  ) {
    this._client = client;
    this._projectId = projectId;
    this._projectName = projectName;
  }

  protected abstract _buildPayload(
    evalId: string,
    projectId: string,
    evalRunName: string,
    createdAt: string,
    examples: Example[],
    scorers: S[],
  ): ExampleEvaluationRun;

  protected abstract _submit(
    projectId: string,
    evalId: string,
    examples: Example[],
    scorers: S[],
    payload: ExampleEvaluationRun,
  ): Promise<number>;

  protected async _poll(
    projectId: string,
    evalId: string,
    expectedCount: number,
    timeoutSeconds: number,
  ): Promise<{ results: ExperimentRunItem[]; url: string }> {
    const startTime = Date.now();

    while (true) {
      const elapsed = (Date.now() - startTime) / 1000;
      if (elapsed > timeoutSeconds) {
        throw new Error(`Evaluation timed out after ${timeoutSeconds}s`);
      }

      const response = await this._client.getV1projectsExperimentsByRunId(
        projectId,
        evalId,
      );
      const resultsData = response.results ?? [];
      const completed = resultsData.length;

      if (completed >= expectedCount) {
        const url = response.ui_results_url ?? "Failed to get UI results URL";
        console.log(
          `${pc.green("\u2713")} Evals completed and saved in ${pc.bold(`${elapsed.toFixed(1)}s`)}`,
        );
        // The experiments alias now returns a union (legacy experiment rows |
        // offline test-run rows). This hosted runner only drives the legacy
        // experiment path, so the rows are ExperimentRunItem at runtime.
        return { results: resultsData as ExperimentRunItem[], url };
      }

      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  }

  protected _displayResults(
    examples: Example[],
    resultsData: ExperimentRunItem[],
    url: string,
    assertTest: boolean,
  ): ScoringResult[] {
    const results: ScoringResult[] = [];

    console.log();

    if (assertTest) {
      Logger.warning(
        "assertTest is deprecated and ignored by the current " +
          "evaluation result payload.",
      );
    }

    for (let i = 0; i < resultsData.length; i++) {
      const res = resultsData[i];
      // Rows from the experiments alias may be legacy experiment rows or
      // offline test-run rows; both carry judge_name/score_type/typed
      // values, so parse tolerantly like the Python SDK does.
      const scorersData: ScorerData[] = (res.scorers ?? []).map((scorer) => {
        const row = scorer as unknown as Record<string, unknown>;
        const metadata = row.additional_metadata ?? row.metadata;
        return {
          name: typeof row.judge_name === "string" ? row.judge_name : null,
          value: scorerValue(row),
          scoreType:
            typeof row.score_type === "string" ? row.score_type : null,
          // Tolerate both encodings: boolean|null (test-run rows) and
          // numeric 0/1 (legacy experiment rows).
          success:
            typeof row.success === "boolean"
              ? row.success
              : typeof row.success === "number"
                ? row.success !== 0
                : null,
          error: typeof row.error === "string" ? row.error : null,
          evaluationModel:
            typeof row.evaluation_model === "string"
              ? row.evaluation_model
              : null,
          additionalMetadata:
            typeof metadata === "object" && metadata !== null
              ? (metadata as Record<string, unknown>)
              : {},
          id: typeof row.scorer_data_id === "string" ? row.scorer_data_id : null,
          minimumScoreRange:
            typeof row.minimum_score_range === "number"
              ? row.minimum_score_range
              : 0,
          maximumScoreRange:
            typeof row.maximum_score_range === "number"
              ? row.maximum_score_range
              : 1,
        };
      });

      console.log(`${pc.cyan("\u2022")} Example ${i + 1}:`);
      for (const s of scorersData) {
        const valueStr =
          typeof s.value === "number" ? s.value.toFixed(3) : (s.value ?? "N/A");
        console.log(`  ${pc.dim(`${s.name}:`)} ${pc.cyan(String(valueStr))}`);
        if (s.error) console.log(`    ${pc.red(s.error)}`);
      }

      results.push({ scorersData, example: examples[i] });
    }

    console.log();
    console.log(
      `${pc.bold(pc.green("\u2713"))} Results ready (${results.length})`,
    );
    console.log(`${pc.dim("View full details:")} ${pc.underline(url)}`);
    console.log();

    return results;
  }

  async run(
    examples: Example[],
    scorers: S[],
    evalRunName: string,
    assertTest: boolean = false,
    timeoutSeconds: number = 300,
  ): Promise<ScoringResult[]> {
    if (!this._projectId) {
      Logger.error(
        "Project ID is not resolved. Evaluation requires a valid project.",
      );
      return [];
    }
    const projectId = this._projectId;
    const evalId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    console.log();
    console.log(pc.bold(pc.cyan("Starting Evaluation")));
    console.log(`${pc.dim("Run:")} ${evalRunName}`);
    console.log(`${pc.dim("Project:")} ${this._projectName}`);
    console.log(
      `${pc.dim("Examples:")} ${examples.length} | ${pc.dim("Scorers:")} ${scorers.length}`,
    );
    console.log();

    const payload = this._buildPayload(
      evalId,
      projectId,
      evalRunName,
      createdAt,
      examples,
      scorers,
    );

    const expectedCount = await this._submit(
      projectId,
      evalId,
      examples,
      scorers,
      payload,
    );

    const { results: resultsData, url } = await this._poll(
      projectId,
      evalId,
      expectedCount,
      timeoutSeconds,
    );

    return this._displayResults(examples, resultsData, url, assertTest);
  }
}
