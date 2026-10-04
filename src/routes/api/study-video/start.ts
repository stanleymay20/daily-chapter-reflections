import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { loadOwnedVisualGuide } from "@/lib/study-media.server";
import { bearer, loadVideoRow, patchVideoRow } from "@/lib/study-video.server";
import { STUDY_VIDEO_MODEL, STUDY_VIDEO_PROMPT_VERSION, buildVideoPrompt, buildVideoScenes } from "@/lib/study-video.shared";
import { VideoGatewayError, createStudyVideo } from "@/lib/video-gateway.server";

const schema = z.object({
  jobId: z.string().uuid(),
  passage: z.string().regex(/^[1-3]?[A-Z]{2,3}\.[0-9]{1,3}$/),
  versionId: z.number().int().positive(),
  guideHash: z.string().regex(/^[0-9a-f]{64}$/),
  reference: z.string().trim().min(1).max(120),
});

const json = (message: string, status: number, extra?: Record<string, unknown>) => Response.json({ message, ...extra }, { status });

export const Route = createFileRoute("/api/study-video/start")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: z.infer<typeof schema>;
        try {
          input = schema.parse(await request.json());
        } catch {
          return json("The saved chapter guide is not ready for a video aid.", 400);
        }
        const auth = bearer(request);
        if (!auth) return json("Sign in in Settings to use AI study tools.", 401);
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return json("AI study tools are not configured on this deployment.", 500);

        // The reserved row must exist, belong to the caller (RLS), match the request and still be queued.
        const row = await loadVideoRow(auth, input.jobId).catch(() => null);
        if (!row) return json("This video job no longer exists. Refresh and try again.", 404);
        if (row.status !== "queued" || row.passage !== input.passage || row.version_id !== input.versionId
          || row.guide_hash !== input.guideHash || row.prompt_version !== STUDY_VIDEO_PROMPT_VERSION || row.model !== STUDY_VIDEO_MODEL) {
          return json("This video job is not available to start.", 409);
        }

        // Guide is re-read from the caller's persisted cache and re-hashed; client guide text is never used.
        const guide = await loadOwnedVisualGuide(request, input.passage, input.versionId, input.guideHash);
        if (!guide.ok) return json(guide.error, guide.status);
        const scenes = buildVideoScenes(guide.value);
        if (!scenes.length) return json("The saved chapter guide has no events to visualise.", 409);

        // Dedicated 'video' quota, consumed only once everything else is valid.
        const { authorizeAiRequest } = await import("@/lib/ai-access.server");
        const access = await authorizeAiRequest(request, "video");
        if (!access.ok) {
          await patchVideoRow(auth, row.id, { status: "failed", last_error: access.error }).catch(() => null);
          return json(access.error, access.status, access.retryAfter ? { retryAfter: access.retryAfter } : undefined);
        }
        if (row.user_id !== access.userId) return json("This video job does not belong to the signed-in user.", 403);

        const claimed = await patchVideoRow(auth, row.id, { status: "generating", progress: 0, scenes, last_error: null }, { status: "eq.queued" }).catch(() => null);
        if (!claimed) return json("This video job was already started elsewhere.", 409);

        try {
          const job = await createStudyVideo(apiKey, buildVideoPrompt(input.reference, guide.value, scenes), request.signal);
          await patchVideoRow(auth, row.id, { provider_job_id: job.id, progress: job.progress ?? 0 });
          return Response.json({ id: row.id, status: "generating" });
        } catch (error) {
          const status = error instanceof VideoGatewayError ? error.status : 502;
          const message = error instanceof Error ? error.message : "The video provider could not start this clip.";
          await patchVideoRow(auth, row.id, { status: "failed", last_error: message.slice(0, 1000) }).catch(() => null);
          return json(message, status === 401 ? 502 : status);
        }
      },
    },
  },
});
