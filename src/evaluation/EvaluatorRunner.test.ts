import { describe, expect, test } from "bun:test";
import { Example } from "../data/Example";
import { JudgmentApiClient } from "../internal/api/client";
import type { ExampleEvaluationRun } from "../internal/api/models/ExampleEvaluationRun";
import type { ExperimentRunItem } from "../internal/api/models/ExperimentRunItem";
import type { ScoringResult } from "../data/ScoringResult";
import { EvaluatorRunner } from "./EvaluatorRunner";

class TestRunner extends EvaluatorRunner<string> {
  protected _buildPayload(): ExampleEvaluationRun {
    throw new Error("not used");
  }

  protected _submit(): Promise<number> {
    throw new Error("not used");
  }

  display(
    examples: Example[],
    resultsData: ExperimentRunItem[],
    assertTest = false,
  ): ScoringResult[] {
    return this._displayResults(
      examples,
      resultsData,
      "https://example.com/results",
      assertTest,
    );
  }
}

function runner(): TestRunner {
  return new TestRunner(
    new JudgmentApiClient("https://api.example.com", "key", "org"),
    "project-1",
    "project",
  );
}

function item(scorers: Record<string, unknown>[]): ExperimentRunItem {
  return { scorers } as unknown as ExperimentRunItem;
}

describe("EvaluatorRunner._displayResults", () => {
  test("parses judge_name and typed values from current result rows", () => {
    const results = runner().display(
      [Example.create({})],
      [
        item([
          {
            judge_name: "relevancy",
            score_type: "numeric",
            num_value: 0.875,
            bool_value: false,
            str_value: "",
            success: true,
            error: null,
          },
          {
            judge_name: "grounded",
            score_type: "binary",
            bool_value: true,
            success: null,
          },
          {
            judge_name: "tone",
            score_type: "categorical",
            str_value: "friendly",
            success: null,
          },
        ]),
      ],
    );

    expect(results).toHaveLength(1);
    const [a, b, c] = results[0].scorersData;
    expect(a).toMatchObject({
      name: "relevancy",
      value: 0.875,
      scoreType: "numeric",
      success: true,
      error: null,
    });
    expect(b).toMatchObject({ name: "grounded", value: "Yes", success: null });
    expect(c).toMatchObject({ name: "tone", value: "friendly" });
  });

  test("falls back across typed values when score_type is missing", () => {
    const results = runner().display(
      [Example.create({})],
      [item([{ judge_name: "j", num_value: 0.5 }])],
    );
    expect(results[0].scorersData[0].value).toBe(0.5);
  });

  test("coerces legacy numeric success to boolean", () => {
    const results = runner().display(
      [Example.create({})],
      [item([{ judge_name: "a", success: 1 }, { judge_name: "b", success: 0 }])],
    );
    expect(results[0].scorersData[0].success).toBe(true);
    expect(results[0].scorersData[1].success).toBe(false);
  });

  test("assertTest is deprecated and never throws", () => {
    const results = runner().display(
      [Example.create({})],
      [item([{ judge_name: "j", score_type: "binary", bool_value: false, success: false }])],
      true,
    );
    expect(results).toHaveLength(1);
  });

  test("carries metadata, model, id, and score-range defaults", () => {
    const results = runner().display(
      [Example.create({})],
      [
        item([
          {
            judge_name: "j",
            num_value: 1,
            metadata: { reasoning: "ok" },
            evaluation_model: "gpt-4o",
            scorer_data_id: "sd-1",
          },
        ]),
      ],
    );
    const s = results[0].scorersData[0];
    expect(s.additionalMetadata).toEqual({ reasoning: "ok" });
    expect(s.evaluationModel).toBe("gpt-4o");
    expect(s.id).toBe("sd-1");
    expect(s.minimumScoreRange).toBe(0);
    expect(s.maximumScoreRange).toBe(1);
  });

  test("tolerates empty scorer arrays and missing fields", () => {
    const results = runner().display(
      [Example.create({}), Example.create({})],
      [item([]), item([{ judge_name: null }])],
    );
    expect(results[0].scorersData).toEqual([]);
    expect(results[1].scorersData[0]).toMatchObject({
      name: null,
      value: null,
      success: null,
    });
  });
});
