import { describe, expect, it } from "vitest";
import { commitCategories, processingSteps, repositoryAvailabilities, routeChangeTypes, runStatuses } from "../../src/server/contracts/processing";

describe("processing contracts", () => {
  it("matches the documented repository availability states", () => {
    expect(repositoryAvailabilities).toEqual(["CONFIGURATION_REQUIRED", "PROCESSING", "READY"]);
  });

  it("keeps configuration and executable run states distinct", () => {
    expect(runStatuses).toContain("NEEDS_CONFIGURATION");
    expect(runStatuses).toContain("WAITING_RATE_LIMIT");
    expect(runStatuses).toContain("CANCELLED");
  });

  it("ends processing with activation and completion", () => {
    expect(processingSteps.slice(-2)).toEqual(["ACTIVATE_RUN", "COMPLETE"]);
  });

  it("does not infer an unmatched commit category", () => {
    expect(commitCategories).toContain("UNCATEGORIZED");
  });

  it("limits route topology events to additions and removals", () => {
    expect(routeChangeTypes).toEqual(["ADDED", "REMOVED"]);
  });
});
