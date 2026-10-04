import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

function source(relativeFromTest: string) {
  return readFileSync(new URL(relativeFromTest, import.meta.url), "utf8");
}

const migration = source("../../../supabase/migrations/20261004090000_study_image_persistence.sql");
const imageRoute = source("../../routes/api/generate-study-image.ts");
const imageHook = source("../../hooks/useStudyVisuals.ts");
const imageClient = source("../study-media.ts");
const imageServer = source("../study-media.server.ts");
const reader = source("../../routes/read.$passage.tsx");
const guidedMigration = source("../../../supabase/migrations/20260817205000_guided_study_memory.sql");
const appliedGuided = source("../../../drizzle/migrations/0002_guided_study_memory.sql");
const appliedImages = source("../../../drizzle/migrations/0003_study_image_persistence.sql");
const appliedGrants = source("../../../drizzle/migrations/0004_study_memory_media_grants.sql");

describe("durable study-image contract", () => {
  it("keeps media private and user-owned at both database and storage layers", () => {
    expect(migration).toContain("alter table public.study_image_jobs enable row level security");
    expect(migration).toContain("alter table public.study_images enable row level security");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("(select auth.uid()) = user_id");
    expect(migration).toContain("Private media bucket 'study-images' (public = false");
    expect(migration).not.toMatch(/storage\.buckets/);
    expect(migration).toContain("(storage.foldername(name))[1] = (select auth.uid())::text");
  });

  it("prevents concurrent duplicate paid generations and expires abandoned locks", () => {
    expect(migration).toContain("study_image_jobs_one_active_idx");
    expect(migration).toContain("where status in ('queued','generating')");
    expect(migration).toContain("reserve_study_image_job");
    expect(migration).toContain("interval '15 minutes'");
    expect(migration).toContain("security invoker");
    expect(migration).toContain("revoke all on function public.reserve_study_image_job");
  });

  it("grounds image generation in the persisted guide rather than browser-supplied guide prose", () => {
    expect(imageRoute).toContain("loadOwnedVisualGuide");
    expect(imageRoute).toContain("claimOwnedImageJob");
    expect(imageRoute).toContain('authorizeAiRequest(request, "image")');
    expect(imageRoute).not.toContain("input.summary");
    expect(imageRoute).not.toContain("input.events");
    expect(imageServer).toContain("ai_insights_cache");
    expect(imageServer).toContain("studyGuideHash");
  });

  it("cancels the browser request and forwards cancellation to the upstream image provider", () => {
    expect(imageHook).toContain("new AbortController()");
    expect(imageHook).toContain("abortRef.current.abort()");
    expect(imageRoute).toContain("request.signal");
    expect(imageRoute).toContain('aborted ? "cancelled" : "failed"');
  });

  it("persists successful images and restores signed URLs instead of spending another generation credit", () => {
    expect(imageClient).toContain('.upload(storagePath, blob');
    expect(imageClient).toContain("createSignedUrl");
    expect(imageClient).toContain("loadStudyImages");
    expect(imageClient).toContain("loadCachedStudyGuide");
    expect(imageClient).toContain("saveCachedStudyGuide");
    expect(reader).toContain("Saved chapter illustration");
    expect(reader).toContain("Saved versions");
    expect(reader).toContain("Create again");
  });
});

describe("production schema convergence", () => {
  it("applies the canonical guided-study and study-image migrations byte-for-byte", () => {
    expect(appliedGuided).toBe(guidedMigration);
    expect(appliedImages).toBe(migration);
  });

  it("keeps guided study owner-scoped and non-destructive", () => {
    for (const table of ["chapter_studies", "daily_reviews"]) {
      expect(guidedMigration).toContain(`alter table public.${table} enable row level security`);
      for (const op of ["select", "insert", "update", "delete"]) expect(guidedMigration).toMatch(new RegExp(`on public\\.${table} for ${op} .*auth\\.uid\\(\\) = user_id`));
    }
    expect(guidedMigration).not.toMatch(/\b(drop|truncate|delete from)\b/i);
    expect(migration).not.toMatch(/\b(drop table|drop column|truncate)\b/i);
  });

  it("grants signed-in access, removes signed-out access, and never uses SECURITY DEFINER for job reservation", () => {
    for (const table of ["chapter_studies", "daily_reviews", "study_image_jobs", "study_images"]) {
      expect(appliedGrants).toContain(`revoke all on public.${table} from anon`);
    }
    expect(appliedGrants).toContain("grant select, insert, update, delete on public.chapter_studies to authenticated");
    expect(appliedGrants).toContain("grant select, insert, update, delete on public.daily_reviews to authenticated");
    expect(migration).not.toMatch(/security definer/i);
    expect(migration).toContain("set search_path = public, pg_temp");
  });

  it("uploads new pictures without overwriting, so no storage UPDATE policy is needed", () => {
    expect(imageClient).toContain("upsert: false");
    expect(imageClient).toContain("${auth.userId}/${args.passage}/${versionId}/${args.jobId}.png");
    expect(migration).not.toContain("for update to authenticated\n  using (\n    bucket_id");
  });
});
