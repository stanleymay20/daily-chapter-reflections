import type { StudyMode } from "./study-state";

export type ThemeMode = "system" | "light" | "dark" | "sepia";
export type HighlightColor = "yellow" | "green" | "blue" | "pink" | "purple";
export type ReadingWidth = "narrow" | "comfortable" | "wide";

export type AppSettings = {
  theme: ThemeMode;
  fontSize: number;
  lineHeight: number;
  readingWidth: ReadingWidth;
  showVerseNumbers: boolean;
  distractionFree: boolean;
  studyMode: StudyMode;
  audioRate: number;
  autoScroll: boolean;
  reminderEnabled: boolean;
  reminderTime: string;
  eveningReminderEnabled: boolean;
  eveningReminderTime: string;
  timezone: string;
  chaptersPerDay: number;
  activeTracks: string[];
};

export type SavedVerse = {
  id: string;
  passage: string;
  verse: string;
  reference: string;
  text: string;
  highlight?: HighlightColor;
  note?: string;
  bookmarked?: boolean;
  updatedAt: string;
};

const SETTINGS_KEY = "bible-study:settings:v1";
const SAVED_KEY = "bible-study:saved-verses:v1";

export const DEFAULT_SETTINGS: AppSettings = {
  theme: "sepia",
  fontSize: 20,
  lineHeight: 1.9,
  readingWidth: "comfortable",
  showVerseNumbers: true,
  distractionFree: false,
  studyMode: "standard",
  audioRate: 1,
  autoScroll: false,
  reminderEnabled: true,
  reminderTime: "05:00",
  eveningReminderEnabled: false,
  eveningReminderTime: "19:00",
  timezone: "Europe/Berlin",
  chaptersPerDay: 7,
  activeTracks: ["Law", "History", "Psalms", "Wisdom", "Prophets", "Gospels", "Acts & Epistles"],
};

function browser() { return typeof window !== "undefined"; }

export function loadSettings(): AppSettings {
  if (!browser()) return DEFAULT_SETTINGS;
  try { return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}") }; }
  catch { return DEFAULT_SETTINGS; }
}

export function saveSettings(settings: AppSettings) {
  if (browser()) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function loadSavedVerses(): SavedVerse[] {
  if (!browser()) return [];
  try { return JSON.parse(localStorage.getItem(SAVED_KEY) || "[]") as SavedVerse[]; }
  catch { return []; }
}

export function upsertSavedVerse(item: SavedVerse) {
  if (!browser()) return;
  const rows = loadSavedVerses();
  const index = rows.findIndex((x) => x.id === item.id);
  if (index >= 0) rows[index] = item; else rows.unshift(item);
  localStorage.setItem(SAVED_KEY, JSON.stringify(rows));
}

export function removeSavedVerse(id: string) {
  if (!browser()) return;
  localStorage.setItem(SAVED_KEY, JSON.stringify(loadSavedVerses().filter((x) => x.id !== id)));
}

export function safeShareText(reference: string, text: string, max = 180) {
  const clean = text.replace(/\s+/g, " ").trim();
  return `${reference} — ${clean.length > max ? `${clean.slice(0, max - 1)}…` : clean}`;
}

export function readingWidthClass(width: ReadingWidth) {
  return width === "narrow" ? "max-w-xl" : width === "wide" ? "max-w-4xl" : "max-w-2xl";
}
