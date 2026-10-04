import { STUDY_VIDEO_TTS_MODEL, STUDY_VIDEO_TTS_VOICE } from "./study-video.shared";

const BASE_URL = "https://ai.gateway.lovable.dev";

export class SpeechGatewayError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function ascii(view: DataView, offset: number, length: number) {
  return Array.from({ length }, (_, i) => String.fromCharCode(view.getUint8(offset + i))).join("");
}

/** Parse a PCM WAV duration from its fmt/data chunks. Finalization fails rather than guessing caption timing. */
export function wavDurationSeconds(bytes: ArrayBuffer): number {
  const view = new DataView(bytes);
  if (view.byteLength < 44 || ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") throw new Error("Narration returned an invalid WAV file.");
  let offset = 12;
  let byteRate = 0;
  let dataSize = 0;
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const body = offset + 8;
    if (id === "fmt " && size >= 16 && body + 12 <= view.byteLength) byteRate = view.getUint32(body + 8, true);
    if (id === "data") { dataSize = Math.min(size, Math.max(0, view.byteLength - body)); break; }
    offset = body + size + (size % 2);
  }
  if (!byteRate || !dataSize) throw new Error("Narration WAV duration metadata is missing.");
  const seconds = dataSize / byteRate;
  if (!Number.isFinite(seconds) || seconds <= 0 || seconds > 90) throw new Error("Narration duration is outside the allowed scene range.");
  return Math.round(seconds * 100) / 100;
}

export async function generateStudyNarration(apiKey: string, text: string, signal?: AbortSignal) {
  const input = text.replace(/\s+/g, " ").trim();
  if (!input || input.length > 1800) throw new SpeechGatewayError(400, "Narration text is outside the allowed scene length.");
  const response = await fetch(`${BASE_URL}/v1/audio/speech`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: STUDY_VIDEO_TTS_MODEL,
      input,
      voice: STUDY_VIDEO_TTS_VOICE,
      response_format: "wav",
      speed: 0.94,
      instructions: "Calm, clear, warm documentary narration. Reverent but natural. No character impersonation, no dramatic acting, no whispering.",
    }),
    signal: signal ?? null,
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
    throw new SpeechGatewayError(response.status, body?.message ?? body?.error?.message ?? `Narration generation failed (${response.status}).`);
  }
  const bytes = await response.arrayBuffer();
  return { bytes, mimeType: response.headers.get("content-type") || "audio/wav", durationSeconds: wavDurationSeconds(bytes) };
}
