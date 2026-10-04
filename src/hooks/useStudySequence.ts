import { useCallback, useEffect, useRef, useState } from "react";

import type { StudyInsights } from "@/lib/insights.functions";
import { hashInsightsForImage } from "@/lib/study-media";
import {
  advanceSequenceStep,
  cancelSequence,
  deleteSequence,
  loadSequences,
  reserveSequence,
  retrySequenceStage,
  startSequence,
  type ActiveSequence,
  type SavedSequence,
  type StepView,
} from "@/lib/study-sequence";
import { SEQUENCE_MAX_ADVANCE_STEPS, modeForStudy, type SequenceMode } from "@/lib/study-sequence.shared";

const WAIT_MS = 8000;
const NEXT_MS = 600;

/**
 * Drives the study sequence pipeline only after an explicit user action (or to resume an in-flight
 * job). Each advance runs one bounded server step; polling stops on terminal states, cancel,
 * unmount, or after SEQUENCE_MAX_ADVANCE_STEPS. Nothing is retried automatically.
 */
export function useStudySequence(args: { passage: string; versionId: string | undefined; label: string; insights: StudyInsights | null; studyMode: string | undefined }) {
  const preferred = modeForStudy(args.studyMode);
  const [mode, setMode] = useState<SequenceMode>(preferred.mode);
  const [saved, setSaved] = useState<SavedSequence[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [active, setActive] = useState<ActiveSequence | null>(null);
  const [step, setStep] = useState<StepView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const loop = useRef<{ timer: number | null; abort: AbortController | null; steps: number; alive: boolean }>({ timer: null, abort: null, steps: 0, alive: true });

  useEffect(() => setMode(modeForStudy(args.studyMode).mode), [args.studyMode]);

  const stop = useCallback(() => {
    const l = loop.current;
    if (l.timer) window.clearTimeout(l.timer);
    l.abort?.abort();
    l.timer = null;
    l.abort = null;
  }, []);

  const refresh = useCallback(async () => {
    if (!args.versionId) return null;
    try {
      const result = await loadSequences(args.versionId, args.passage);
      setSaved(result.saved);
      setSelectedId((current) => (current && result.saved.some((s) => s.id === current) ? current : result.saved[0]?.id ?? null));
      setActive(result.active);
      return result;
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "";
      if (!message.startsWith("Sign in")) setError(message);
      return null;
    }
  }, [args.passage, args.versionId]);

  const drive = useCallback((jobId: string) => {
    stop();
    const l = loop.current;
    l.steps = 0;
    const tick = async () => {
      if (!l.alive) return;
      l.steps += 1;
      l.abort = new AbortController();
      let delay = WAIT_MS;
      try {
        const view = await advanceSequenceStep(jobId, args.label, l.abort.signal);
        setStep(view);
        setActive({ id: view.id, status: view.status, stage: view.stage, error: view.error, mode: view.mode });
        if (view.status === "completed") {
          setNotice("Study video saved. It will be here after reload and on your other signed-in devices.");
          setActive(null);
          await refresh();
          return;
        }
        if (view.status === "failed" || view.status === "cancelled") {
          if (view.status === "failed") setError(view.error || "The study video could not be completed.");
          return;
        }
        delay = view.worked && !view.waiting ? NEXT_MS : WAIT_MS;
      } catch (stepError) {
        if (stepError instanceof DOMException && stepError.name === "AbortError") return;
        setError(stepError instanceof Error ? stepError.message : "The study video step failed.");
        return; // no automatic retry; the user can resume explicitly
      }
      if (l.steps >= SEQUENCE_MAX_ADVANCE_STEPS) {
        setNotice("This is taking longer than usual. Tap Resume to keep going.");
        return;
      }
      l.timer = window.setTimeout(() => void tick(), delay);
    };
    l.timer = window.setTimeout(() => void tick(), 300);
  }, [args.label, refresh, stop]);

  useEffect(() => {
    loop.current.alive = true;
    stop();
    setSaved([]);
    setSelectedId(null);
    setActive(null);
    setStep(null);
    setError("");
    setNotice("");
    // Never generate on load: only resume a job that is already generating.
    void refresh().then((result) => {
      if (result?.active?.status === "generating") drive(result.active.id);
    });
    return () => {
      loop.current.alive = false;
      stop();
    };
  }, [refresh, drive, stop]);

  const generate = useCallback(async (force: boolean) => {
    if (!args.versionId || !args.insights || busy) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const guideHash = await hashInsightsForImage(args.insights);
      const reservation = await reserveSequence(args.versionId, args.passage, guideHash, mode, force);
      if (reservation.reused) {
        setNotice("This guide already has a saved study video in this mode. Nothing new was generated.");
        setSelectedId(reservation.id);
        return;
      }
      if (!reservation.created) {
        setNotice("A study video for this chapter is already being created. No duplicate was started.");
        drive(reservation.id);
        return;
      }
      await startSequence(reservation.id);
      setActive({ id: reservation.id, status: "generating", stage: "planning", error: null, mode });
      drive(reservation.id);
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : "The study video could not be started.");
      await refresh();
    } finally {
      setBusy(false);
    }
  }, [args.insights, args.passage, args.versionId, busy, drive, mode, refresh]);

  const cancel = useCallback(async () => {
    if (!active) return;
    stop();
    await cancelSequence(active.id).catch(() => undefined);
    setActive(null);
    setStep(null);
    setNotice("Cancelled. Motion scenes already started with the provider may still use credits.");
  }, [active, stop]);

  const retry = useCallback(async () => {
    if (!active || active.status !== "failed") return;
    setError("");
    try {
      await retrySequenceStage(active.id);
      setActive({ ...active, status: "generating", error: null });
      drive(active.id);
    } catch (retryError) {
      setError(retryError instanceof Error ? retryError.message : "The stage could not be retried.");
    }
  }, [active, drive]);

  const resume = useCallback(() => {
    if (active?.status === "generating") drive(active.id);
  }, [active, drive]);

  const remove = useCallback(async (id: string) => {
    try {
      await deleteSequence(id);
      await refresh();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "The study video could not be deleted.");
    }
  }, [refresh]);

  const selected = saved.find((s) => s.id === selectedId) ?? saved[0] ?? null;
  const generating = busy || active?.status === "generating" || active?.status === "queued";
  return { mode, setMode, suggested: preferred.suggested, saved, selected, setSelectedId, active, step, generating, error, notice, generate, cancel, retry, resume, remove };
}
