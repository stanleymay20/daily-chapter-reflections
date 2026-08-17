/**
 * Reading plan data module.
 *
 * Keep this file as the single source of truth for the reading plan so that a
 * full 365-day plan can be imported later without touching UI code.
 */

export type BookCode =
  | "GEN"
  | "EXO"
  | "NEH"
  | "PSA"
  | "PRO"
  | "ZEP"
  | "LUK"
  | "1CO"
  | (string & {});

export type ChapterRef = {
  /** Human readable book name, e.g. "Genesis" */
  book: string;
  /** USFM book code, e.g. "GEN" */
  usfm: BookCode;
  chapter: number;
  /** Track label for the seven-chapter structure */
  track: string;
};

export type DayPlan = {
  /** ISO date in Europe/Berlin, format YYYY-MM-DD */
  date: string;
  chapters: ChapterRef[];
};

/** Human book name -> USFM code mapping used by the plan. */
export const USFM_BY_BOOK: Record<string, string> = {
  Genesis: "GEN",
  Exodus: "EXO",
  Leviticus: "LEV",
  Numbers: "NUM",
  Deuteronomy: "DEU",
  Nehemiah: "NEH",
  Psalm: "PSA",
  Psalms: "PSA",
  Proverbs: "PRO",
  Zephaniah: "ZEP",
  Matthew: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Romans: "ROM",
  "1 Corinthians": "1CO",
  "2 Corinthians": "2CO",
};

export function toUsfm(book: string): string {
  const code = USFM_BY_BOOK[book.trim()];
  if (!code) throw new Error(`Unknown book name: ${book}`);
  return code;
}

/** Build a chapter passage id, e.g. GEN.42 */
export function passageId(usfm: string, chapter: number): string {
  if (!/^[1-9A-Z]{3}$/.test(usfm)) throw new Error(`Invalid USFM book code: ${usfm}`);
  if (!Number.isInteger(chapter) || chapter < 1 || chapter > 150) {
    throw new Error(`Invalid chapter number: ${chapter}`);
  }
  return `${usfm}.${chapter}`;
}

export function chapterLabel(ref: ChapterRef): string {
  return `${ref.book} ${ref.chapter}`;
}

const chapter = (book: string, ch: number, track: string): ChapterRef => ({
  book,
  usfm: toUsfm(book),
  chapter: ch,
  track,
});

export const PLAN: DayPlan[] = [
  {
    date: "2026-08-17",
    chapters: [
      chapter("Genesis", 42, "Law"),
      chapter("Nehemiah", 3, "History"),
      chapter("Psalm", 79, "Psalms"),
      chapter("Proverbs", 25, "Wisdom"),
      chapter("Zephaniah", 2, "Prophets"),
      chapter("Luke", 7, "Gospels"),
      chapter("1 Corinthians", 14, "Epistles"),
    ],
  },
];

export function getPlanForDate(date: string): DayPlan | undefined {
  return PLAN.find((d) => d.date === date);
}

/** Today's date (YYYY-MM-DD) in Europe/Berlin. */
export function berlinToday(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function formatBerlinDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(y!, (m ?? 1) - 1, d ?? 1)));
}

/** Find a chapter in the plan by passage id, e.g. "GEN.42". */
export function findChapterByPassageId(id: string): { date: string; ref: ChapterRef } | undefined {
  for (const day of PLAN) {
    for (const ref of day.chapters) {
      if (passageId(ref.usfm, ref.chapter) === id) return { date: day.date, ref };
    }
  }
  return undefined;
}
