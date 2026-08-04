import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { issueStemJobToken, verifyStemJobToken } from "@/lib/serverStemJob";

const originalSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;

describe("stem job capability tokens", () => {
  beforeEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-secret";
  });

  afterEach(() => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalSecret;
  });

  it("binds a backend job to one project source asset", () => {
    const claims = {
      jobId: "job-1",
      projectId: "project-1",
      sourceAssetId: "asset-1",
    };
    const token = issueStemJobToken(claims);

    expect(verifyStemJobToken(token, claims)).toBe(true);
    expect(
      verifyStemJobToken(token, { ...claims, sourceAssetId: "asset-2" })
    ).toBe(false);
  });
});
