import { TRACKS, getPlanForDate, type ChapterRef } from "./schedule";

/**
 * User plans are independent of the immutable seven-track 2026 plan.
 * They never modify TRACKS or the canonical chapter generator.
 */
export type PersonalBook = { usfm: string; fromChapter: number };
export type PersonalPlan = {
  name: string;
  startDate: string;
  chaptersPerDay: number;
  weekdays: number[]; // UTC weekday (0 Sunday through 6 Saturday)
  books: PersonalBook[]; // ordered; each book read from its selected chapter
  repeat: boolean;
};
export type ReadingPlanChoice = {
  readingPlanMode?: "unselected" | "original" | "personal";
  personalReadingPlan?: PersonalPlan;
  activeTracks: string[];
  chaptersPerDay: number;
};

export const BOOK_LIBRARY = TRACKS.flatMap(group => group.books.map(book => ({
  ...book, track: group.track,
})));

export const DEFAULT_PERSONAL_PLAN: PersonalPlan = {
  name: "My reading plan",
  startDate: "2026-01-01",
  chaptersPerDay: 2,
  weekdays: [0, 1, 2, 3, 4, 5, 6],
  books: [{ usfm: "GEN", fromChapter: 1 }, { usfm: "MAT", fromChapter: 1 }],
  repeat: false,
};

const DAY_MS = 86_400_000;
function validDate(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [y, m, d] = date.split("-").map(Number);
  const ms = Date.UTC(y!, m! - 1, d!);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === date ? ms : null;
}

export function normalizePersonalPlan(plan: PersonalPlan | undefined): PersonalPlan {
  const raw = plan ?? DEFAULT_PERSONAL_PLAN;
  const books: PersonalBook[] = [];
  for (const item of Array.isArray(raw.books) ? raw.books : []) {
    const book = BOOK_LIBRARY.find(x => x.usfm === item.usfm);
    if (!book || books.some(x => x.usfm === item.usfm)) continue;
    const fromChapter = Number(item.fromChapter);
    books.push({ usfm: book.usfm, fromChapter: Number.isInteger(fromChapter) ? Math.max(1, Math.min(book.chapters, fromChapter)) : 1 });
  }
  const weekdays = [...new Set((Array.isArray(raw.weekdays) ? raw.weekdays : []).filter(x => Number.isInteger(x) && x >= 0 && x <= 6))].sort();
  return {
    name: (typeof raw.name === "string" ? raw.name.trim().slice(0, 60) : "") || "My reading plan",
    startDate: validDate(raw.startDate) === null ? DEFAULT_PERSONAL_PLAN.startDate : raw.startDate,
    chaptersPerDay: Math.min(10, Math.max(1, Number.isInteger(raw.chaptersPerDay) ? raw.chaptersPerDay : 2)),
    weekdays,
    books,
    repeat: raw.repeat === true,
  };
}

export function personalReadingsForDate(date: string, configuration: PersonalPlan): ChapterRef[] {
  const plan = normalizePersonalPlan(configuration);
  const start = validDate(plan.startDate);
  const current = validDate(date);
  if (start === null || current === null || current < start || !plan.books.length || !plan.weekdays.length) return [];
  const elapsed = Math.round((current - start) / DAY_MS);
  // Avoid unbounded loops for extreme dates. The app supports 100 years of scheduling.
  if (elapsed > 36_525) return [];
  const weekdaySet = new Set(plan.weekdays);
  if (!weekdaySet.has(new Date(current).getUTCDay())) return [];
  let studyDays = 0;
  for (let day = 0; day <= elapsed; day++) {
    if (weekdaySet.has(new Date(start + day * DAY_MS).getUTCDay())) studyDays++;
  }
  const chapters = plan.books.flatMap(selected => {
    const book = BOOK_LIBRARY.find(item => item.usfm === selected.usfm);
    return book ? Array.from({ length: book.chapters - selected.fromChapter + 1 }, (_, i): ChapterRef => ({
      book: book.book, usfm: book.usfm, chapter: selected.fromChapter + i, track: "Personal",
    })) : [];
  });
  if (!chapters.length) return [];
  const firstIndex = (studyDays - 1) * plan.chaptersPerDay;
  if (!plan.repeat && firstIndex >= chapters.length) return [];
  return Array.from({ length: plan.chaptersPerDay }, (_, index) => {
    const absolute = firstIndex + index;
    return !plan.repeat && absolute >= chapters.length ? null : chapters[absolute % chapters.length]!;
  }).filter((chapter): chapter is ChapterRef => chapter !== null);
}

/** Resolves the selected reading plan for all calendar, today, export and reader views. */
export function scheduledChapters(date: string, settings: ReadingPlanChoice): ChapterRef[] {
  if (settings.readingPlanMode === "unselected") return [];
  if (settings.readingPlanMode === "personal") return personalReadingsForDate(date, settings.personalReadingPlan ?? DEFAULT_PERSONAL_PLAN);
  const canonical = getPlanForDate(date)?.chapters ?? [];
  return canonical.filter(chapter => settings.activeTracks.includes(chapter.track))
    .slice(0, Math.max(1, Math.min(7, settings.chaptersPerDay)));
}
