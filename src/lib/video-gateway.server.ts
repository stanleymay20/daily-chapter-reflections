import { STUDY_VIDEO_DURATION_SECONDS, STUDY_VIDEO_MODEL, STUDY_VIDEO_RESOLUTION } from "./study-video.shared";

const BASE_URL = "https://ai.gateway.lovable.dev";

export type GatewayVideoJob = {
  id: string;
  status: "queued" | "in_progress" | "completed" | "failed";
  progress?: number;
  error?: { code?: string; message?: string };
};

export class VideoGatewayError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

async function jobResponse(response: Response): Promise<GatewayVideoJob> {
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string } | null;
    throw new VideoGatewayError(response.status, body?.message ?? `Video request failed (${response.status}).`);
  }
  return (await response.json()) as GatewayVideoJob;
}

/** One create per explicit user action. Never retried automatically. */
export async function createStudyVideo(apiKey: string, prompt: string, signal?: AbortSignal, seconds: number = STUDY_VIDEO_DURATION_SECONDS) {
  return jobResponse(
    await fetch(`${BASE_URL}/v1/videos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: STUDY_VIDEO_MODEL,
        input: prompt,
        response_format: { type: "video", resolution: STUDY_VIDEO_RESOLUTION, duration: `${Math.round(seconds)}s`, aspect_ratio: "16:9" },
      }),
      signal: signal ?? null,
    }),
  );
}

export async function pollStudyVideo(apiKey: string, id: string) {
  return jobResponse(
    await fetch(`${BASE_URL}/v1/videos/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${apiKey}` } }),
  );
}

export async function downloadStudyVideo(apiKey: string, id: string): Promise<ArrayBuffer> {
  const response = await fetch(`${BASE_URL}/v1/videos/${encodeURIComponent(id)}/content`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!response.ok) throw new VideoGatewayError(response.status, `Video download failed (${response.status}).`);
  return response.arrayBuffer();
}
