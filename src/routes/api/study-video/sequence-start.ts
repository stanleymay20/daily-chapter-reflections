import { createFileRoute } from "@tanstack/react-router";

import { bearerOf, jobSchema, json, loadTrustedSources } from "@/lib/study-sequence-routes.server";
import { AI_MESSAGES } from "@/lib/ai-error";
import { ProviderError, restDb } from "@/lib/study-sequence.server";
import { guideReadinessIssue } from "@/lib/study-sequence.shared";

/**
 * Starts a reserved study sequence: verifies ownership, the immutable guide hash and the trusted
 * sources, then charges the dedicated 'video' quota once. No provider spend happens here.
 */
export const Route = createFileRoute("/api/study-video/sequence-start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = jobSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json("Invalid study video job.", 400);
        const auth = bearerOf(request);
        if (!auth) return json("Sign in in Settings to use AI study tools.", 401);
        const db = restDb(auth);
        const row = await db.loadVideo(parsed.data.jobId).catch(() => null);
        if (!row || row.kind !== "sequence") return json("This study video no longer exists.", 404);
        if (row.status !== "queued" || row.stage !== "planning") return json("This study video is not available to start.", 409);

        try {
          const trusted = await loadTrustedSources(auth, row.passage, row.version_id, row.guide_hash, request.signal);
          const readiness = guideReadinessIssue(row.study_mode ?? "quick", trusted.sources, trusted.chapterText);
          if (readiness) {
            // No quota or paid provider calls have been consumed.
            await db.patchVideo(row.id, { status: "cancelled", stage_error: readiness }, { status: "eq.queued" }).catch(() => null);
            return json(readiness, 422);
          }
        } catch (error) {
          const message = error instanceof ProviderError ? error.message : "The saved chapter guide could not be verified.";
          // The job never started and was never authorized to spend provider
          // calls. Do not leave a failed/planning row that can be retried.
          await db.patchVideo(row.id, { status: "cancelled", stage_error: message }, { status: "eq.queued" }).catch(() => null);
          return json(message, error instanceof ProviderError ? error.status : 503);
        }

        const { authorizeAiRequest } = await import("@/lib/ai-access.server");
        const access = await authorizeAiRequest(request, "video");
        if (!access.ok) {
          const message = access.status === 429
            ? access.error === AI_MESSAGES.dayLimit
              ? "Daily video generation limit reached: at most 2 started videos per UTC day. Unfinished or failed generations still count toward this cost-control limit."
              : "Hourly video generation limit reached: at most 1 new video per hour. Retry a previously authorized failed stage only if its request budget allows."
            : access.error;
          // A quota-denied reservation is not an authorized video. Cancellation
          // is safer than "failed": retry must never turn it into a provider job.
          await db.patchVideo(row.id, { status: "cancelled", stage_error: message }, { status: "eq.queued" }).catch(() => null);
          return json(message, access.status, access.retryAfter ? { retryAfter: access.retryAfter } : undefined);
        }
        if (access.userId !== row.user_id) return json("This study video does not belong to the signed-in user.", 403);

        const claimed = await db.patchVideo(row.id, { status: "generating" }, { status: "eq.queued" }).catch(() => null);
        if (!claimed) return json("This study video was already started elsewhere.", 409);
        return Response.json({ id: row.id, status: "generating", stage: "planning" });
      },
    },
  },
});
