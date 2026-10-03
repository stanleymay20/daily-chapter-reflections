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
const publicConfig = source("../../integrations/supabase/public-config.ts");
const integrationClient = source("../../integrations/supabase/client.ts");
const quotaMigration = source("../../../supabase/migrations/20261003093500_ai_usage_quota.sql");

describe("paid AI authorization boundary", () => {
  it("derives identity from a Supabase-validated bearer token without service-role access", () => {
    expect(aiAccess).toContain('authHeader?.startsWith("Bearer ")');
    expect(aiAccess).toContain('/auth/v1/user');
    expect(aiAccess).toContain('Authorization: `Bearer ${token}`');
    expect(aiAccess).not.toContain("supabaseAdmin");
    expect(aiAccess).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
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

describe("deployment-safe public Supabase configuration", () => {
  it("checks in only public browser configuration as an explicit fallback", () => {
    expect(publicConfig).toContain('DEFAULT_SUPABASE_PROJECT_ID = "xjvtpiyyfabuxgtdvynu"');
    expect(publicConfig).toContain('DEFAULT_SUPABASE_URL = "https://xjvtpiyyfabuxgtdvynu.supabase.co"');
    expect(publicConfig).toMatch(/DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_[^"]+"/);
    expect(publicConfig).not.toContain("service_role");
    expect(publicConfig).not.toContain("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("keeps Vite environment overrides while preventing missing-env startup failure", () => {
    expect(publicConfig).toContain('import.meta.env["VITE_SUPABASE_URL"] || DEFAULT_SUPABASE_URL');
    expect(publicConfig).toContain('import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || DEFAULT_SUPABASE_PUBLISHABLE_KEY');
    expect(integrationClient).toContain("publicSupabaseUrl()");
    expect(integrationClient).toContain("publicSupabasePublishableKey()");
    expect(integrationClient).not.toContain("Missing Supabase environment variable");
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
