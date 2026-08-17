export type StudyMode = "read" | "quick" | "standard" | "deep";
export type StudyStep = "prepare" | "read" | "understand" | "reflect" | "pray" | "review";

export type ReflectionAnswer = {
  observation?: string;
  understanding?: string;
  reflection?: string;
  application?: string;
};

export type ChapterStudy = {
  passage: string;
  intention?: string;
  reflections: ReflectionAnswer;
  prayer?: string;
  completedAt?: string;
  updatedAt: string;
};

export type DailyReview = {
  date: string;
  gratitude?: string;
  takeaway?: string;
  prayer?: string;
  updatedAt: string;
};

const CHAPTER_KEY = "bible-study:chapter-study:v1";
const DAILY_KEY = "bible-study:daily-review:v1";

function browser() { return typeof window !== "undefined"; }

function readMap<T>(key: string): Record<string, T> {
  if (!browser()) return {};
  try { return JSON.parse(localStorage.getItem(key) || "{}") as Record<string, T>; }
  catch { return {}; }
}

function writeMap<T>(key: string, value: Record<string, T>) {
  if (!browser()) return;
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* quota */ }
}

export function loadChapterStudy(passage: string): ChapterStudy {
  const row = readMap<ChapterStudy>(CHAPTER_KEY)[passage];
  return row ?? { passage, reflections: {}, updatedAt: new Date(0).toISOString() };
}

export function saveChapterStudy(passage: string, patch: Partial<Omit<ChapterStudy, "passage">>): ChapterStudy {
  const rows = readMap<ChapterStudy>(CHAPTER_KEY);
  const current = rows[passage] ?? { passage, reflections: {}, updatedAt: new Date(0).toISOString() };
  const next: ChapterStudy = {
    ...current,
    ...patch,
    passage,
    reflections: { ...current.reflections, ...(patch.reflections ?? {}) },
    updatedAt: new Date().toISOString(),
  };
  rows[passage] = next;
  writeMap(CHAPTER_KEY, rows);
  return next;
}

export function allChapterStudies(): ChapterStudy[] {
  return Object.values(readMap<ChapterStudy>(CHAPTER_KEY)).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt));
}

export function loadDailyReview(date: string): DailyReview {
  return readMap<DailyReview>(DAILY_KEY)[date] ?? { date, updatedAt: new Date(0).toISOString() };
}

export function saveDailyReview(date: string, patch: Partial<Omit<DailyReview, "date">>): DailyReview {
  const rows = readMap<DailyReview>(DAILY_KEY);
  const next: DailyReview = { ...(rows[date] ?? { date, updatedAt: new Date(0).toISOString() }), ...patch, date, updatedAt: new Date().toISOString() };
  rows[date] = next;
  writeMap(DAILY_KEY, rows);
  return next;
}

export function allDailyReviews(): DailyReview[] {
  return Object.values(readMap<DailyReview>(DAILY_KEY)).sort((a,b)=>b.date.localeCompare(a.date));
}

export function estimateMinutes(chapters: number, mode: StudyMode) {
  const perChapter = mode === "read" ? 5 : mode === "quick" ? 10 : mode === "standard" ? 18 : 32;
  return Math.max(1, chapters) * perChapter;
}

export function nextStudyStep(step: StudyStep): StudyStep {
  const order: StudyStep[] = ["prepare","read","understand","reflect","pray","review"];
  return order[Math.min(order.indexOf(step) + 1, order.length - 1)] ?? "review";
}

export function summarizeOwnStudy(studies: ChapterStudy[]) {
  const completed = studies.filter(s=>s.completedAt).length;
  const notes = studies.filter(s=>Object.values(s.reflections).some(Boolean)).length;
  const prayers = studies.filter(s=>Boolean(s.prayer?.trim())).length;
  return { completed, notes, prayers };
}
