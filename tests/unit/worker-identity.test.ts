import { describe, expect, it } from "vitest";
import { createWorkerId } from "../../worker/identity";

describe("worker identity", () => {
  it("honors a configured identity", () => {
    expect(createWorkerId("worker-primary")).toBe("worker-primary");
  });

  it("creates distinct process identities", () => {
    expect(createWorkerId()).not.toBe(createWorkerId());
  });
});
