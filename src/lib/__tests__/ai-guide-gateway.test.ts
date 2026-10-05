import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { aiErrorKind } from "../ai-error";

const insightsSource = readFileSync(new URL("../insights.functions.ts", import.meta.url), "utf8");

function gatewayMessage(status: number) {
  if (status === 400 || status === 404) return "The configured AI model is unavailable on this deployment. Please try again later.";
  if (status === 402) return "AI credits are exhausted for this workspace. Add credits in Lovable (Settings → Plans & credits) to use AI study tools.";
  if (status === 403) return "AI access is blocked by workspace policy or a credit limit.";
  if (status === 429) return "AI service is rate limited right now. Please wait a moment and try again.";
  if (status >= 500) return "AI service is temporarily unavailable. Please try again.";
  return "AI study tools could not complete this request. Please try again.";
}

describe("Bible study AI gateway hardening", () => {
  it("uses the shared Video Aid Responses provider boundary instead of the legacy chat model", () => {
    expect(insightsSource).toContain('await import("./study-sequence.server")');
    expect(insightsSource).toContain("gatewayProviders(key).json");
    expect(insightsSource).toContain("STUDY_INSIGHTS_JSON_SCHEMA");
    expect(insightsSource).toContain("ASK_CHAPTER_JSON_SCHEMA");
    expect(insightsSource).not.toContain("/v1/chat/completions");
    expect(insightsSource).not.toContain("google/gemini-3.6-flash");
  });

  it("keeps auth and user quota checks in front of provider calls", () => {
    const auth = insightsSource.indexOf('authorizeCurrentAiRequest("insights")');
    const provider = insightsSource.indexOf("gatewayJson<StudyInsights>");
    expect(auth).toBeGreaterThan(-1);
    expect(provider).toBeGreaterThan(auth);
  });

  it("keeps provider errors safe and actionable", () => {
    expect(gatewayMessage(402)).toMatch(/credits are exhausted/i);
    expect(gatewayMessage(404)).toMatch(/configured AI model is unavailable/i);
    expect(gatewayMessage(500)).toMatch(/temporarily unavailable/i);
    expect(insightsSource).not.toContain("return message||");
  });

  it("shows terminal configuration/credit causes instead of hiding them as transient errors", () => {
    expect(aiErrorKind("AI credits are exhausted for this workspace.")).toBe("quota");
    expect(aiErrorKind("AI study tools are not configured on this deployment.")).toBe("quota");
    expect(aiErrorKind("The configured AI model is unavailable on this deployment. Please try again later.")).toBe("quota");
    expect(aiErrorKind("AI access is blocked by workspace policy or a credit limit.")).toBe("quota");
  });

  it("keeps genuine transient failures retryable", () => {
    expect(aiErrorKind("AI service is rate limited right now. Please wait a moment and try again.")).toBe("retry");
    expect(aiErrorKind("AI service is temporarily unavailable. Please try again.")).toBe("retry");
  });
});
