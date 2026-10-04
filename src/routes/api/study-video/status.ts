import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { bearer, loadVideoRow, patchVideoRow, uploadVideo, videoStoragePath, type VideoRow } from "@/lib/study-video.server";
import { downloadStudyVideo, pollStudyVideo } from "@/lib/video-gateway.server";

const schema = z.object({ jobId: z.string().uuid() });

function view(row: VideoRow) {
  return { id: row.id, status: row.status, progress: row.progress, storagePath: row.storage_path, error: row.last_error };
}

/** Polls one owned job. Never creates a provider job, never consumes quota, never retries a failed create. */
export const Route = createFileRoute("/api/study-video/status")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: z.infer<typeof schema>;
        try {
          input = schema.parse(await request.json());
        } catch {
          return Response.json({ message: "Invalid video job." }, { status: 400 });
        }
        const auth = bearer(request);
        if (!auth) return Response.json({ message: "Sign in in Settings to use AI study tools." }, { status: 401 });
        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ message: "AI study tools are not configured on this deployment." }, { status: 500 });

        const row = await loadVideoRow(auth, input.jobId).catch(() => null);
        if (!row) return Response.json({ message: "This video job was not found." }, { status: 404 });
        if (row.status !== "generating" || !row.provider_job_id) return Response.json(view(row));

        try {
          const job = await pollStudyVideo(apiKey, row.provider_job_id);
          if (job.status === "failed") {
            const message = job.error?.code === "moderation_blocked"
              ? "The video provider's safety filter blocked this clip. Nothing was saved."
              : job.error?.message || "The video provider could not finish this clip.";
            const failed = await patchVideoRow(auth, row.id, { status: "failed", last_error: message.slice(0, 1000) }, { status: "eq.generating" });
            return Response.json(view(failed ?? { ...row, status: "failed", last_error: message }));
          }
          if (job.status !== "completed") {
            const progress = typeof job.progress === "number" ? Math.max(0, Math.min(99, Math.round(job.progress))) : row.progress;
            if (progress !== row.progress) await patchVideoRow(auth, row.id, { progress }, { status: "eq.generating" }).catch(() => null);
            return Response.json(view({ ...row, progress }));
          }
          // Completed: store the MP4 privately right away (provider URLs expire), then record the path.
          const path = videoStoragePath(row);
          await uploadVideo(auth, path, await downloadStudyVideo(apiKey, row.provider_job_id));
          const done = await patchVideoRow(auth, row.id, { status: "completed", progress: 100, storage_path: path, last_error: null }, { status: "eq.generating" });
          return Response.json(view(done ?? (await loadVideoRow(auth, row.id)) ?? row));
        } catch (error) {
          console.error("[study-video] status check failed", error instanceof Error ? error.message : error);
          return Response.json({ ...view(row), transient: true, message: "Checking the video took too long. It will keep trying." }, { status: 200 });
        }
      },
    },
  },
});
