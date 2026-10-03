import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativeFromTest: string) {
  return readFileSync(new URL(relativeFromTest, import.meta.url), "utf8");
}

const aiAccess = source("../ai-access.server.ts");
const insights = source("../insights.functions.ts");
const memory = source("../study-memory.functions.ts");
const narration = source("../narration.functions.ts");
const imageRoute = source("../../routes/api/generate-study-image.ts");
const imageClient = source("../stream-image.ts");
const quotaMigration = source("../../../supabase/migrations/20261003093500_ai_usage_quota.sql");

describe("paid AI authorization boundary", () => {
  it("derives identity from a verified Supabase bearer token", () => {
    expect(aiAccess).toContain('authHeader?.startsWith("Bearer ")');
    expect(aiAccess).toContain("supabaseAdmin.auth.getUser(token)");
    expect(aiAccess).not.toMatch(/userId\s*:\s*data\./);
  });

  it("fails closed when authentication or quota infrastructure cannot be verified", () => {
    expect(aiAccess).toContain('status: 503');
    expect(aiAccess).toContain("AI access could not be verified");
    expect(aiAccess).toContain("/rest/v1/rpc/consume_ai_quota");
  });

  it("protects every cost-bearing server function", () => {
    expect(insights).toContain('authorizeCurrentAiRequest("insights")');
    expect(insights).toContain('authorizeCurrentAiRequest("ask_chapter")');
    expect(memory).toContain('authorizeCurrentAiRequest("study_memory")');
    expect(narration).toContain('authorizeCurrentAiRequest("narration")');
    expect(imageRoute).toContain('authorizeAiRequest(request, "image")');
  });

  it("attaches the signed-in session to raw image requests", () => {
    expect(imageClient).toContain("supabase.auth.getSession()");
    expect(imageClient).toContain('baseHeaders.set("Authorization", `Bearer ${token}`)');
  });
});

describe("database-backed AI quota contract", () => {
  it("keeps quota state private and identity server-derived", () => {
    expect(quotaMigration).toContain("alter table public.ai_usage_counters enable row level security");
    expect(quotaMigration).toContain("revoke all on table public.ai_usage_counters from public, anon, authenticated");
    expect(quotaMigration).toContain("v_user_id uuid := auth.uid()");
    expect(quotaMigration).toContain("security definer");
    expect(quotaMigration).toContain("set search_path = pg_catalog, public");
  });

  it("serializes concurrent quota decisions in PostgreSQL", () => {
    expect(quotaMigration).toMatch(/from public\.ai_usage_counters[\s\S]*for update;/i);
    expect(quotaMigration).toContain("primary key (user_id, feature)");
  });

  it("keeps feature limits server-side and grants only the intended RPC", () => {
    expect(quotaMigration).toContain("when 'insights' then v_hour_limit := 24; v_day_limit := 80");
    expect(quotaMigration).toContain("when 'ask_chapter' then v_hour_limit := 60; v_day_limit := 200");
    expect(quotaMigration).toContain("when 'study_memory' then v_hour_limit := 20; v_day_limit := 60");
    expect(quotaMigration).toContain("when 'narration' then v_hour_limit := 12; v_day_limit := 40");
    expect(quotaMigration).toContain("when 'image' then v_hour_limit := 6; v_day_limit := 15");
    expect(quotaMigration).toContain("revoke all on function public.consume_ai_quota(text) from public, anon");
    expect(quotaMigration).toContain("grant execute on function public.consume_ai_quota(text) to authenticated, service_role");
  });
});
