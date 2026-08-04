import { describe, expect, it } from "vitest";
import {
  isOnboardingComplete,
  normalizePlugins,
  normalizeUserProfile,
} from "@/lib/userProfile";

describe("user profile helpers", () => {
  it("accepts an empty plugin collection as stock-only", () => {
    expect(normalizePlugins([])).toEqual([]);
  });

  it("keeps Waves Ultimate instead of the overlapping Gold bundle", () => {
    expect(
      normalizePlugins(["waves_gold", "fabfilter", "waves_ultimate"])
    ).toEqual(["fabfilter", "waves_ultimate"]);
  });

  it("requires both a supported DAW and a completion timestamp", () => {
    const profile = normalizeUserProfile({
      id: "user-1",
      daw: "FL Studio",
      genres: [],
      plugins: ["soundtoys"],
      created_at: "2026-07-21T00:00:00.000Z",
      onboarding_completed_at: "2026-07-21T00:01:00.000Z",
    });

    expect(isOnboardingComplete(profile)).toBe(true);
    expect(
      isOnboardingComplete(
        normalizeUserProfile({
          ...profile,
          daw: "Unsupported DAW",
        })
      )
    ).toBe(false);
  });
});
