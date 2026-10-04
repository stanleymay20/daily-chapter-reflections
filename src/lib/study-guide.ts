export const STUDY_IMAGE_PROMPT_VERSION = "study-image-v2";

export type VisualStudyGuide = {
  summary: string;
  eventSequence: string[];
  visualTimeline: string[];
  relationships: string[];
  placeNotes: string[];
};

function cleanStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function visualStudyGuide(value: unknown): VisualStudyGuide | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record["summary"] !== "string" || !record["summary"].trim()) return null;
  const eventSequence = cleanStrings(record["eventSequence"]);
  if (!eventSequence.length) return null;
  return {
    summary: record["summary"].trim(),
    eventSequence,
    visualTimeline: cleanStrings(record["visualTimeline"]),
    relationships: cleanStrings(record["relationships"]),
    placeNotes: cleanStrings(record["placeNotes"]),
  };
}

export async function studyGuideHash(value: VisualStudyGuide): Promise<string> {
  const normalized: VisualStudyGuide = {
    summary: value.summary.trim(),
    eventSequence: cleanStrings(value.eventSequence),
    visualTimeline: cleanStrings(value.visualTimeline),
    relationships: cleanStrings(value.relationships),
    placeNotes: cleanStrings(value.placeNotes),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(normalized));
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
