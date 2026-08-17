import { createServerFn } from "@tanstack/react-start";

const DEFAULT_VOICE = "JBFqnCBsd6RMkjVDRZzb";
const MAX_TEXT = 9_500;

export type NarrationResponse =
  | { ok: true; audioBase64: string; mimeType: "audio/mpeg"; provider: "elevenlabs" }
  | { ok: false; error: string; unavailable?: boolean };

function clean(text: string) {
  return text.replace(/\s+/g, " ").trim().slice(0, MAX_TEXT);
}

export const generateNarrationFn = createServerFn({ method: "POST" })
  .inputValidator((input: { text: string }) => input)
  .handler(async ({ data }): Promise<NarrationResponse> => {
    const apiKey = process.env["ELEVENLABS_API_KEY"];
    if (!apiKey) {
      return { ok: false, unavailable: true, error: "Neural narration is not configured yet." };
    }
    const text = clean(data.text);
    if (!text) return { ok: false, error: "There is no chapter text to narrate." };

    const voiceId = process.env["ELEVENLABS_VOICE_ID"] || DEFAULT_VOICE;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 45_000);
    try {
      const response = await fetch(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=mp3_44100_128`,
        {
          method: "POST",
          headers: { "xi-api-key": apiKey, "content-type": "application/json", accept: "audio/mpeg" },
          body: JSON.stringify({
            text,
            model_id: process.env["ELEVENLABS_MODEL_ID"] || "eleven_multilingual_v2",
            voice_settings: { stability: 0.58, similarity_boost: 0.76, style: 0.12, use_speaker_boost: true, speed: 0.94 },
          }),
          signal: controller.signal,
        },
      );
      if (!response.ok) {
        console.error(`ElevenLabs narration failed: ${response.status}`);
        return { ok: false, error: response.status === 401 ? "Neural narration credentials were rejected." : "Neural narration could not be generated. Try again." };
      }
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { ok: true, audioBase64: Buffer.from(bytes).toString("base64"), mimeType: "audio/mpeg", provider: "elevenlabs" };
    } catch (error) {
      const timedOut = error instanceof Error && error.name === "AbortError";
      return { ok: false, error: timedOut ? "Neural narration took too long. Try again." : "Neural narration is temporarily unavailable." };
    } finally {
      clearTimeout(timeout);
    }
  });
