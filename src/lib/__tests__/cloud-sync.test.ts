import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

type Res = { data?: unknown; error?: { code?: string; message?: string } | null };
const responses: Record<string, { upsert?: Res; select?: Res }> = {};
const upserts: Record<string, unknown[]> = {};
const auth = { getUser: vi.fn() };

function table(name: string) {
  const r = () => responses[name] ?? {};
  const selectResult = () => ({ data: r().select?.data ?? [], error: r().select?.error ?? null });
  const chain: any = {
    upsert: (rows: unknown) => { (upserts[name] ??= []).push(rows); return Promise.resolve({ error: r().upsert?.error ?? null }); },
    select: () => chain,
    eq: () => Object.assign(Promise.resolve(selectResult()), { maybeSingle: () => Promise.resolve(selectResult()) }),
  };
  return chain;
}
vi.mock("../supabase", () => ({ requireSupabase: () => ({ auth, from: table }) }));

import { SyncError, loadLastSync, pullCloudStudyData, syncStudyData } from "../cloud-sync";

const store = new Map<string, string>();
Object.defineProperty(globalThis, "window", { value: { localStorage: { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v), removeItem: (k: string) => void store.delete(k) } }, configurable: true });
const MISSING = { code: "PGRST205", message: "Could not find the table 'public.chapter_studies' in the schema cache" };

beforeEach(() => {
  store.clear(); for (const k of Object.keys(responses)) delete responses[k]; for (const k of Object.keys(upserts)) delete upserts[k];
  auth.getUser.mockResolvedValue({ data: { user: { id: "u1" } } });
  store.set("7cbs.progress.v1", JSON.stringify({ "2026-10-04|GEN.42": "complete", "2026-10-04|1CO.14": "reading" }));
  store.set("7cbs.notes.v1", JSON.stringify({ "GEN.42": "Joseph remembers", "1CO.14": "" }));
  store.set("bible-study:chapter-study:v1", JSON.stringify({ "GEN.42": { passage: "GEN.42", reflections: { observation: "x" }, updatedAt: "2026-10-04T10:00:00Z" } }));
});

describe("cloud sync", () => {
  it("root cause: chapter_notes passage check regex must match real ids like GEN.42", () => {
    const fixed = readFileSync(resolve(__dirname, "../../../supabase/migrations/20261004221800_fix_chapter_notes_passage_check.sql"), "utf8");
    const m = fixed.match(/passage ~ '([^']+)'/g)!.pop()!.match(/'([^']+)'/)![1]!;
    expect(m).not.toContain("\\\\");
    const re = new RegExp(m);
    for (const id of ["GEN.42", "1CO.14", "PSA.119"]) expect(re.test(id)).toBe(true);
    // The broken constraint (double backslash) rejected every real passage id.
    expect(new RegExp("^[1-3]?[A-Z]{2,3}\\\\.[0-9]{1,3}$").test("GEN.42")).toBe(false);
  });

  it("successful round trip pushes all core stages and records last sync", async () => {
    responses["chapter_notes"] = { select: { data: [{ passage: "GEN.42", note: "Joseph remembers" }] } };
    const at = await syncStudyData();
    expect(upserts["user_settings"]).toHaveLength(1);
    expect((upserts["reading_progress"]![0] as unknown[]).length).toBe(2);
    expect(upserts["chapter_notes"]![0]).toEqual(expect.arrayContaining([expect.objectContaining({ passage: "GEN.42", note: "Joseph remembers" })]));
    expect(loadLastSync()).toBe(at);
  });

  it("skips optional tables only when they are not deployed", async () => {
    responses["chapter_studies"] = { upsert: { error: MISSING }, select: { error: MISSING } };
    responses["daily_reviews"] = { select: { error: { code: "42P01", message: 'relation "daily_reviews" does not exist' } } };
    await expect(syncStudyData()).resolves.toBeTypeOf("string");
    expect(JSON.parse(store.get("bible-study:chapter-study:v1")!)["GEN.42"].reflections.observation).toBe("x");
  });

  it("does not swallow permission errors on optional tables", async () => {
    responses["chapter_studies"] = { upsert: { error: { code: "42501", message: "permission denied" } } };
    await expect(syncStudyData()).rejects.toMatchObject({ stage: "chapter_studies", operation: "push", kind: "permission" });
  });

  it("core failure reports stage/operation with safe copy and keeps local data", async () => {
    responses["chapter_notes"] = { upsert: { error: { code: "23514", message: 'violates check constraint "chapter_notes_passage_check"' } } };
    const before = store.get("7cbs.notes.v1");
    const err = await syncStudyData().catch((e) => e);
    expect(err).toBeInstanceOf(SyncError);
    expect(err).toMatchObject({ stage: "notes", operation: "push", code: "23514", kind: "data" });
    expect(err.message).not.toMatch(/constraint|chapter_notes|23514/);
    expect(store.get("7cbs.notes.v1")).toBe(before);
    expect(loadLastSync()).toBeNull();
  });

  it("empty cloud never erases local data", async () => {
    const before = [...store.entries()];
    await pullCloudStudyData();
    for (const [k, v] of before) expect(store.get(k)).toBe(v);
  });

  it("signed-out sync fails at the auth stage", async () => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    await expect(syncStudyData()).rejects.toMatchObject({ stage: "auth", kind: "auth" });
  });

  it("settings UI: guarded single-flight sync with Syncing/Synced/Try again states, and sign-in never fails on sync", () => {
    const ui = readFileSync(resolve(__dirname, "../../routes/settings.tsx"), "utf8");
    expect(ui).toContain("syncLock.current");
    expect(ui).toContain("Syncing your study data…");
    expect(ui).toMatch(/Synced\{/);
    expect(ui).toContain('"Try again"');
    expect(ui).not.toContain("Cloud sync failed");
    expect(ui).toMatch(/void sync\(\)\};/);
  });
});
