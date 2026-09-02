import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { errorCodes } from "../../src/server/contracts/errors";

interface ContractFixture {
  errors: string[];
}

interface ApiContracts {
  preflight: ContractFixture;
  timeline: ContractFixture;
  refresh: ContractFixture;
  retry: ContractFixture;
}

describe("API contract fixtures", () => {
  it("uses only stable documented errors", async () => {
    const content = await readFile(new URL("../fixtures/api-contracts.json", import.meta.url), "utf8");
    const contracts = JSON.parse(content) as ApiContracts;
    const usedErrors = Object.values(contracts).flatMap((contract) => contract.errors);

    expect(usedErrors.every((code) => errorCodes.includes(code as (typeof errorCodes)[number]))).toBe(true);
  });

  it("keeps every stable error code unique", () => {
    expect(new Set(errorCodes).size).toBe(errorCodes.length);
  });
});
