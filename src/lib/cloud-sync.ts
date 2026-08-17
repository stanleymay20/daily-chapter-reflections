import { DEFAULT_SETTINGS, type AppSettings } from "./app-state";
import { requireSupabase } from "./supabase.client";

const SETTINGS_KEY = "bible-study:settings:v1";
const PROGRESS_KEY = "7cbs.progress.v1";
const NOTES_KEY = "7cbs.notes.v1";

type StringStore = Record<string, string>;
type ProgressStatus = "not_started" | "reading" | "complete";

function readStore(key: string): StringStore {
  if (typeof window === "undefined") return {};
  try {
    return JSON.parse(window.localStorage.getItem(key) || "{}") as StringStore;
  } catch {
    return {};
  }
}

function writeStore(key: string, value: StringStore) {
  if (typeof window !== "undefined") window.localStorage.setItem(key, JSON.stringify(value));
}

function readSettings(): AppSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    return { ...DEFAULT_SETTINGS, ...JSON.parse(window.localStorage.getItem(SETTINGS_KEY) || "{}") } as AppSettings;
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export async function getCloudUser() {
  const { data } = await requireSupabase().auth.getUser();
  return data.user ?? null;
}

export async function sendSignInLink(email: string) {
  const sb = requireSupabase();
  const redirect = typeof window !== "undefined" ? window.location.origin + "/settings" : null;
  const credentials = redirect ? { email, options: { emailRedirectTo: redirect } } : { email };
  const { error } = await sb.auth.signInWithOtp(credentials);
  if (error) throw error;
}

export async function signOutCloud() {
  const { error } = await requireSupabase().auth.signOut();
  if (error) throw error;
}

export async function pushLocalStudyData() {
  const sb = requireSupabase();
  const user = await getCloudUser();
  if (!user) throw new Error("Sign in before syncing.");

  const settings = readSettings();
  const { error: settingsError } = await sb.from("user_settings").upsert({
    user_id: user.id,
    settings,
    updated_at: new Date().toISOString(),
  });
  if (settingsError) throw settingsError;

  const progress = readStore(PROGRESS_KEY);
  const progressRows = Object.entries(progress).flatMap(([key, status]) => {
    const split = key.indexOf("|");
    if (split < 1) return [];
    const reading_date = key.slice(0, split);
    const passage = key.slice(split + 1);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(reading_date) || !/^[1-3]?[A-Z]{2,3}\.\d{1,3}$/.test(passage)) return [];
    if (!["not_started", "reading", "complete"].includes(status)) return [];
    return [{ user_id: user.id, reading_date, passage, status: status as ProgressStatus, updated_at: new Date().toISOString() }];
  });
  if (progressRows.length) {
    const { error } = await sb.from("reading_progress").upsert(progressRows, { onConflict: "user_id,reading_date,passage" });
    if (error) throw error;
  }

  const notes = readStore(NOTES_KEY);
  const noteRows = Object.entries(notes)
    .filter(([passage]) => /^[1-3]?[A-Z]{2,3}\.\d{1,3}$/.test(passage))
    .map(([passage, note]) => ({ user_id: user.id, passage, note, updated_at: new Date().toISOString() }));
  if (noteRows.length) {
    const { error } = await sb.from("chapter_notes").upsert(noteRows, { onConflict: "user_id,passage" });
    if (error) throw error;
  }
}

export async function pullCloudStudyData() {
  const sb = requireSupabase();
  const user = await getCloudUser();
  if (!user) throw new Error("Sign in before syncing.");

  const [{ data: settingsRow, error: settingsError }, { data: progressRows, error: progressError }, { data: noteRows, error: notesError }] = await Promise.all([
    sb.from("user_settings").select("settings").eq("user_id", user.id).maybeSingle(),
    sb.from("reading_progress").select("reading_date,passage,status").eq("user_id", user.id),
    sb.from("chapter_notes").select("passage,note").eq("user_id", user.id),
  ]);
  if (settingsError) throw settingsError;
  if (progressError) throw progressError;
  if (notesError) throw notesError;

  if (settingsRow?.settings && typeof window !== "undefined") {
    const merged = { ...DEFAULT_SETTINGS, ...(settingsRow.settings as Partial<AppSettings>) };
    window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(merged));
  }

  const localProgress = readStore(PROGRESS_KEY);
  for (const row of progressRows ?? []) localProgress[`${row.reading_date}|${row.passage}`] = row.status;
  writeStore(PROGRESS_KEY, localProgress);

  const localNotes = readStore(NOTES_KEY);
  for (const row of noteRows ?? []) localNotes[row.passage] = row.note;
  writeStore(NOTES_KEY, localNotes);
}

export async function syncStudyData() {
  await pushLocalStudyData();
  await pullCloudStudyData();
}
