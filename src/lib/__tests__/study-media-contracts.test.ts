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

describe("durable study-image contract", () => {
  it("keeps media private and user-owned at both database and storage layers", () => {
    expect(migration).toContain("alter table public.study_image_jobs enable row level security");
    expect(migration).toContain("alter table public.study_images enable row level security");
    expect(migration).toContain("to authenticated");
    expect(migration).toContain("(select auth.uid()) = user_id");
    expect(migration).toContain("values('study-images', 'study-images', false");
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
