import { describe, expect, it } from "vitest";
import { getRunResumePlan } from "../../src/server/jobs/resume-plan";

describe("processing run resume checkpoints", () => {
  it.each([
    ["DISCOVER_HISTORY", [true, true, true, true, true, false]],
    ["FETCH_COMMITS", [true, true, true, true, true, false]],
    ["CLASSIFY_COMMITS", [false, true, true, true, true, false]],
    ["DETECT_DEPENDENCIES", [false, false, true, true, true, false]],
    ["DETECT_ROUTES", [false, false, false, true, true, false]],
    ["VALIDATE_RUN", [false, false, false, false, true, false]],
    ["ACTIVATE_RUN", [false, false, false, false, false, true]],
  ] as const)("resumes from %s without repeating completed stages", (step, stages) => {
    const plan = getRunResumePlan(step);
    expect([
      plan.fetchCommits,
      plan.classifyCommits,
      plan.detectDependencies,
      plan.detectRoutes,
      plan.validateRun,
      plan.activateRun,
    ]).toEqual(stages);
  });

  it("rejects a completed or unknown checkpoint for a claimed job", () => {
    expect(() => getRunResumePlan("COMPLETE")).toThrow("unsupported processing checkpoint");
    expect(() => getRunResumePlan("NOT_A_STEP")).toThrow("unsupported processing checkpoint");
  });
});
