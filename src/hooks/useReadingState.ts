import { useCallback, useEffect, useState } from "react";

export type ProgressStatus = "not_started" | "reading" | "complete";

const PROGRESS_KEY = "7cbs.progress.v1";
const NOTES_KEY = "7cbs.notes.v1";
const VERSION_KEY = "7cbs.version.v1";

type Store = Record<string, string>;

function read(key: string): Store {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as Store) : {};
  } catch {
    return {};
  }
}

function write(key: string, value: Store) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore quota errors */
  }
}

/** Reading progress keyed by `${date}|${passageId}`. */
export function useProgress(date: string) {
  const [store, setStore] = useState<Store>({});

  useEffect(() => {
    setStore(read(PROGRESS_KEY));
  }, []);

  const statusOf = useCallback(
    (passage: string): ProgressStatus =>
      (store[`${date}|${passage}`] as ProgressStatus | undefined) ?? "not_started",
    [store, date],
  );

  const setStatus = useCallback(
    (passage: string, status: ProgressStatus) => {
      setStore((prev) => {
        const next = { ...prev, [`${date}|${passage}`]: status };
        write(PROGRESS_KEY, next);
        return next;
      });
    },
    [date],
  );

  const completedCount = useCallback(
    (passages: string[]) => passages.filter((p) => statusOf(p) === "complete").length,
    [statusOf],
  );

  return { statusOf, setStatus, completedCount };
}

/** Local study notes keyed by passage id. */
export function useNotes(passage: string) {
  const [note, setNote] = useState("");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setNote(read(NOTES_KEY)[passage] ?? "");
    setReady(true);
  }, [passage]);

  const save = useCallback(
    (value: string) => {
      setNote(value);
      const next = { ...read(NOTES_KEY), [passage]: value };
      write(NOTES_KEY, next);
    },
    [passage],
  );

  return { note, save, ready };
}

/** Selected translation id, persisted locally. */
export function useSelectedVersion() {
  const [versionId, setVersionId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined") {
      setVersionId(window.localStorage.getItem(VERSION_KEY));
    }
    setReady(true);
  }, []);

  const select = useCallback((id: string) => {
    setVersionId(id);
    try {
      window.localStorage.setItem(VERSION_KEY, id);
    } catch {
      /* ignore */
    }
  }, []);

  return { versionId, select, ready };
}

export const PREFERRED_VERSION_ID = "111"; // New International Version 2011
export const FALLBACK_VERSION_ID = "3034"; // Berean Standard Bible

export function pickDefaultVersion<T extends { id: string; language: string; abbreviation: string }>(
  bibles: T[],
  stored?: string | null,
): T | undefined {
  if (stored) {
    const found = bibles.find((b) => b.id === stored);
    if (found) return found;
  }
  return (
    bibles.find((b) => b.id === PREFERRED_VERSION_ID) ??
    bibles.find((b) => b.id === FALLBACK_VERSION_ID) ??
    bibles.find((b) => /^en/i.test(b.language) || /english/i.test(b.language)) ??
    bibles[0]
  );
}
