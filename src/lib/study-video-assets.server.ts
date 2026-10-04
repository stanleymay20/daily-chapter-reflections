import { generateImage, imageSettings } from "./image-gateway.server";

export class StudyVideoAssetError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

export async function generateStudyStill(apiKey: string, prompt: string, signal?: AbortSignal) {
  const response = await generateImage({ ...imageSettings, apiKey }, prompt, false, signal);
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { message?: string; error?: { message?: string } } | null;
    throw new StudyVideoAssetError(response.status, body?.message ?? body?.error?.message ?? `Still-image generation failed (${response.status}).`);
  }
  const payload = (await response.json()) as { data?: Array<{ b64_json?: string; url?: string }> };
  const item = payload.data?.[0];
  if (item?.b64_json) return { bytes: Uint8Array.from(Buffer.from(item.b64_json, "base64")), contentType: "image/png" };
  if (item?.url) {
    const download = await fetch(item.url, { signal: signal ?? null });
    if (!download.ok) throw new StudyVideoAssetError(download.status, "The generated still could not be downloaded for private storage.");
    return { bytes: new Uint8Array(await download.arrayBuffer()), contentType: download.headers.get("content-type") || "image/png" };
  }
  throw new StudyVideoAssetError(502, "The image provider returned no usable still image.");
}
