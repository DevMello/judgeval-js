import { describe, expect, test } from "bun:test";
import { Example } from "../data/Example";
import type { JudgmentApiClient } from "../internal/api/client";
import type { ExampleEvaluationRun } from "../internal/api/models/ExampleEvaluationRun";
import type { LocalScorerResult } from "../internal/api/models/LocalScorerResult";
import type { BaseResponse } from "../judges/responses";
import { Judge } from "../judges/Judge";
import { LocalEvaluatorRunner } from "./LocalEvaluatorRunner";

class SubmitRunner extends LocalEvaluatorRunner {
  submit(
    examples: Example[],
    scorers: Judge[],
    payload: ExampleEvaluationRun,
  ): Promise<number> {
    return this._submit("project-1", "eval-1", examples, scorers, payload);
  }
}

function makeRunner(onResults: (results: LocalScorerResult[]) => void): {
  runner: SubmitRunner;
  payload: ExampleEvaluationRun;
} {
  const stubClient = {
    postV1projectsEvalResultsExamples: (
      _projectId: string,
      body: { results: LocalScorerResult[] },
    ) => {
      onResults(body.results);
      return Promise.resolve({});
    },
  } as unknown as JudgmentApiClient;
  const runner = new SubmitRunner(stubClient, "project-1", "project");
  const payload = {
    id: "eval-1",
    project_id: "project-1",
    eval_name: "run",
    created_at: new Date().toISOString(),
    examples: [],
    judgment_scorers: [],
    custom_scorers: [],
  } as unknown as ExampleEvaluationRun;
  return { runner, payload };
}

describe("LocalEvaluatorRunner._submit", () => {
  test("caps concurrent scorer calls at 32", async () => {
    let inFlight = 0;
    let maxInFlight = 0;

    class SlowJudge extends Judge {
      async score(): Promise<BaseResponse> {
        inFlight++;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await new Promise((resolve) => setTimeout(resolve, 5));
        inFlight--;
        return { value: 1, reason: "ok" };
      }
    }

    const { runner, payload } = makeRunner(() => {});
    const examples = Array.from({ length: 100 }, () => Example.create({}));
    const count = await runner.submit(examples, [new SlowJudge()], payload);

    expect(count).toBe(100);
    expect(maxInFlight).toBeLessThanOrEqual(32);
    expect(maxInFlight).toBeGreaterThan(1);
  });

  test("a synchronously throwing scorer becomes a per-scorer error entry", async () => {
    class ThrowingJudge extends Judge {
      score(): Promise<BaseResponse> {
        throw new Error("sync boom");
      }
    }

    let captured: LocalScorerResult[] = [];
    const { runner, payload } = makeRunner((results) => {
      captured = results;
    });
    const count = await runner.submit(
      [Example.create({})],
      [new ThrowingJudge()],
      payload,
    );

    expect(count).toBe(1);
    expect(captured).toHaveLength(1);
    const scorer = captured[0].scorers_data[0] as Record<string, unknown>;
    expect(scorer.error).toContain("sync boom");
    expect(scorer.value).toBe(0);
  });

  test("a rejecting scorer is recorded without failing the run", async () => {
    class RejectingJudge extends Judge {
      score(): Promise<BaseResponse> {
        return Promise.reject(new Error("async boom"));
      }
    }

    let captured: LocalScorerResult[] = [];
    const { runner, payload } = makeRunner((results) => {
      captured = results;
    });
    const count = await runner.submit(
      [Example.create({})],
      [new RejectingJudge()],
      payload,
    );

    expect(count).toBe(1);
    const scorer = captured[0].scorers_data[0] as Record<string, unknown>;
    expect(scorer.error).toContain("async boom");
  });
});
