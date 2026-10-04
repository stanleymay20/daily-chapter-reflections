import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { authorizeAiRequest } from "../ai-access.server";
import { AI_MESSAGES, aiErrorKind } from "../ai-error";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
const req = (t?: string) => new Request("https://x.test/ai", { method: "POST", ...(t ? { headers: { Authorization: `Bearer ${t}` } } : {}) });
const json = (b: unknown, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json" } });
function withQuota(rpc: () => Response | Promise<Response>) {
  const calls: { url: string; body?: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    const u = String(url); calls.push({ url: u, ...(init?.body ? { body: String(init.body) } : {}) });
    if (u.includes("/auth/v1/user")) return json({ id: "user-1" });
    return rpc();
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  return calls;
}
const migration = readFileSync(resolve(__dirname, "../../../supabase/migrations/20261003093500_ai_usage_quota.sql"), "utf8");
const applied = readFileSync(resolve(__dirname, "../../../drizzle/migrations/0001_ai_usage_quota.sql"), "utf8");

describe("consume_ai_quota contract", () => {
  it("missing auth is rejected with the sign-in message and no upstream call", async () => {
    const calls = withQuota(() => json({ allowed: true }));
    await expect(authorizeAiRequest(req(), "insights")).resolves.toEqual({ ok: false, status: 401, error: AI_MESSAGES.signIn });
    expect(calls).toHaveLength(0);
  });

  it("allowed quota returns the validated user and sends only p_feature (never a user id)", async () => {
    const calls = withQuota(() => json({ allowed: true, hourRemaining: 5, dayRemaining: 9 }));
    await expect(authorizeAiRequest(req("tok"), "insights")).resolves.toEqual({ ok: true, userId: "user-1" });
    const rpc = calls.find((c) => c.url.includes("/rpc/consume_ai_quota"))!;
    expect(JSON.parse(rpc.body!)).toEqual({ p_feature: "insights" });
  });

  it("hourly denial maps camelCase retryAfter and scope=hour", async () => {
    withQuota(() => json({ allowed: false, scope: "hour", retryAfter: 120 }));
    await expect(authorizeAiRequest(req("tok"), "image")).resolves.toEqual({ ok: false, status: 429, error: AI_MESSAGES.hourLimit, retryAfter: 120 });
  });

  it("daily denial maps scope=day", async () => {
    withQuota(() => json({ allowed: false, scope: "day", retryAfter: 3600 }));
    await expect(authorizeAiRequest(req("tok"), "insights")).resolves.toMatchObject({ status: 429, error: AI_MESSAGES.dayLimit, retryAfter: 3600 });
  });

  it("snake_case retry_after is NOT the contract (ignored, still denied)", async () => {
    withQuota(() => json({ allowed: false, scope: "hour", retry_after: 60 }));
    const r = await authorizeAiRequest(req("tok"), "insights");
    expect(r).toEqual({ ok: false, status: 429, error: AI_MESSAGES.hourLimit });
  });

  it("invalid feature (22023) and missing function (PGRST202) fail closed", async () => {
    for (const body of [{ code: "22023", message: "unknown AI feature" }, { code: "PGRST202", message: "Could not find the function" }]) {
      withQuota(() => json(body, body.code === "22023" ? 400 : 404));
      await expect(authorizeAiRequest(req("tok"), "insights")).resolves.toEqual({ ok: false, status: 503, error: AI_MESSAGES.unavailable });
    }
  });

  it("malformed payload and network failure fail closed", async () => {
    withQuota(() => json({ ok: true }));
    await expect(authorizeAiRequest(req("tok"), "insights")).resolves.toMatchObject({ ok: false, status: 503 });
    withQuota(() => { throw new TypeError("fetch failed"); });
    await expect(authorizeAiRequest(req("tok"), "insights")).resolves.toMatchObject({ ok: false, status: 503 });
  });

  it("DB function emits the exact keys the server reads and uses auth.uid()", () => {
    expect(migration).toContain("'allowed', false, 'scope', 'day', 'retryAfter'");
    expect(migration).toContain("'allowed', false, 'scope', 'hour', 'retryAfter'");
    expect(migration).not.toMatch(/\bp_user_id\b|'retry_after'/);
    expect(migration).toContain("raise exception using errcode = '22023'");
    expect(applied.trim()).toBe(migration.trim());
  });

  it("Reader classifies errors into sign-in, quota and retry", () => {
    expect(aiErrorKind(AI_MESSAGES.signIn)).toBe("auth");
    expect(aiErrorKind(AI_MESSAGES.sessionExpired)).toBe("auth");
    expect(aiErrorKind(AI_MESSAGES.dayLimit)).toBe("quota");
    expect(aiErrorKind(AI_MESSAGES.hourLimit)).toBe("quota");
    expect(aiErrorKind(AI_MESSAGES.unavailable)).toBe("retry");
  });
});
