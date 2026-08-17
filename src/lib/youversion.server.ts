/**
 * Server-only YouVersion Platform client.
 *
 * The app key is read from process.env.YVP_APP_KEY inside each call and is
 * never returned to the client.
 */
import {
  MISSING_KEY_MESSAGE,
  encodeApiError,
  normalizeApiError,
  type BibleVersion,
  type PassageResult,
} from "./youversion";

const BASE_URL = "https://api.youversion.com/v1";
const TIMEOUT_MS = 12_000;

function appKey(): string {
  const key = process.env["YVP_APP_KEY"];
  if (!key) throw new Error(MISSING_KEY_MESSAGE);
  return key;
}

async function request<T>(path: string): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${BASE_URL}${path}`, {
      headers: { "X-YVP-App-Key": appKey(), accept: "application/json" },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    if (err instanceof Error && err.message === MISSING_KEY_MESSAGE) throw err;
    const aborted = err instanceof Error && err.name === "AbortError";
    throw new Error(
      encodeApiError(normalizeApiError(aborted ? 408 : null, "Could not reach YouVersion.")),
    );
  }
  clearTimeout(timer);

  if (!res.ok) {
    let detail = "";
    try {
      detail = (await res.text()).slice(0, 200);
    } catch {
      /* ignore */
    }
    // Never log the key; log only status + path.
    console.error(`YouVersion API ${res.status} for ${path}`);
    throw new Error(encodeApiError(normalizeApiError(res.status, detail)));
  }

  return (await res.json()) as T;
}

type RawBible = Record<string, unknown>;

function str(obj: RawBible, ...keys: string[]): string {
  for (const k of keys) {
    const v = obj[k];
    if (typeof v === "string" && v.trim()) return v;
    if (typeof v === "number") return String(v);
  }
  return "";
}

function toVersion(raw: RawBible): BibleVersion {
  const language = raw["language"];
  const languageName =
    typeof language === "string"
      ? language
      : language && typeof language === "object"
        ? str(language as RawBible, "name", "local_name", "iso_639_3")
        : "";
  return {
    id: str(raw, "id", "version_id"),
    name: str(raw, "local_title", "title", "name", "local_abbreviation"),
    abbreviation: str(raw, "local_abbreviation", "abbreviation", "abbr"),
    language: languageName,
    copyright: str(raw, "copyright_short", "copyright", "copyright_long", "publisher"),
  };
}

function collection(payload: unknown): RawBible[] {
  if (Array.isArray(payload)) return payload as RawBible[];
  if (payload && typeof payload === "object") {
    for (const key of ["data", "bibles", "items", "results"]) {
      const v = (payload as Record<string, unknown>)[key];
      if (Array.isArray(v)) return v as RawBible[];
    }
  }
  return [];
}

export async function listBibles(): Promise<BibleVersion[]> {
  const payload = await request<unknown>("/bibles");
  return collection(payload)
    .map(toVersion)
    .filter((b) => b.id);
}

function stripTags(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Split a plain-text chapter with inline verse numbers into verses. */
export function splitVerses(text: string): { number: string; text: string }[] {
  const cleaned = text.replace(/\s+/g, " ").trim();
  const matches = [...cleaned.matchAll(/(?:^|\s)(\d{1,3})\s+(?=\S)/g)];
  if (matches.length < 2) return cleaned ? [{ number: "", text: cleaned }] : [];
  const verses: { number: string; text: string }[] = [];
  matches.forEach((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const end = i + 1 < matches.length ? (matches[i + 1]!.index ?? cleaned.length) : cleaned.length;
    const body = cleaned.slice(start, end).trim();
    if (body) verses.push({ number: m[1]!, text: body });
  });
  return verses;
}

export async function getPassage(versionId: string, passage: string): Promise<PassageResult> {
  const payload = await request<Record<string, unknown>>(
    `/bibles/${encodeURIComponent(versionId)}/passages/${encodeURIComponent(passage)}`,
  );

  const data =
    (payload["data"] && typeof payload["data"] === "object"
      ? (payload["data"] as Record<string, unknown>)
      : payload) ?? payload;

  const contentRaw =
    str(data, "content", "text", "passage", "body") || str(payload, "content", "text");

  let verses: { number: string; text: string }[] = [];
  const versesRaw = (data["verses"] ?? data["items"]) as unknown;
  if (Array.isArray(versesRaw)) {
    verses = (versesRaw as RawBible[])
      .map((v) => ({
        number: str(v, "verse", "number", "usfm").replace(/^.*\./, ""),
        text: stripTags(str(v, "text", "content")),
      }))
      .filter((v) => v.text);
  }
  if (verses.length === 0 && contentRaw) verses = splitVerses(stripTags(contentRaw));

  if (verses.length === 0) {
    throw new Error(encodeApiError(normalizeApiError(404, "No text returned for this passage.")));
  }

  return {
    reference: str(data, "reference", "human", "human_reference") || passage,
    versionId,
    versionName: str(data, "version_title", "version", "bible_name") || "",
    copyright: str(data, "copyright", "copyright_short") || "",
    verses,
  };
}
