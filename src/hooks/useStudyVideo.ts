import { useCallback, useEffect, useRef, useState } from "react";

import type { StudyInsights } from "@/lib/insights.functions";
import { hashInsightsForImage } from "@/lib/study-media";
import {
  cancelStudyVideo,
  checkStudyVideo,
  loadStudyVideos,
  reserveStudyVideoJob,
  selectStudyVideo,
  startStudyVideo,
  type StudyVideoVersion,
} from "@/lib/study-video";
import { STUDY_VIDEO_POLL_MS } from "@/lib/study-video.shared";

/** Max ~12 minutes of polling per job; then the user can check again manually. No automatic re-creation ever. */
const MAX_POLLS = 90;

export function useStudyVideo(args: { passage: string; versionId: string | undefined; label: string; insights: StudyInsights | null }) {
  const [versions, setVersions] = useState<StudyVideoVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [progress, setProgress] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const pollRef = useRef<{ timer: number | null; count: number; abort: AbortController | null }>({ timer: null, count: 0, abort: null });

  const stopPolling = useCallback(() => {
    const p = pollRef.current;
    if (p.timer) window.clearTimeout(p.timer);
    p.abort?.abort();
    p.timer = null;
    p.abort = null;
  }, []);

  const refresh = useCallback(async () => {
    if (!args.versionId) return null;
    try {
      const result = await loadStudyVideos(args.versionId, args.passage);
      setVersions(result.versions);
      setSelectedId(result.versions[0]?.id ?? null);
      return result;
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "";
      if (!message.startsWith("Sign in")) setError(message);
      return null;
    }
  }, [args.passage, args.versionId]);

  const poll = useCallback((jobId: string) => {
    stopPolling();
    pollRef.current.count = 0;
    setActiveJobId(jobId);
    const tick = async () => {
      const p = pollRef.current;
      p.count += 1;
      p.abort = new AbortController();
      try {
        const status = await checkStudyVideo(jobId, p.abort.signal);
        setProgress(status.progress);
        if (status.status === "completed") {
          setActiveJobId(null);
          setNotice("Video aid saved. It will return after reload and on your other signed-in devices.");
          await refresh();
          return;
        }
        if (status.status === "failed" || status.status === "cancelled") {
          setActiveJobId(null);
          if (status.status === "failed") setError(status.error || "The video aid could not be created.");
          return;
        }
      } catch (pollError) {
        if (pollError instanceof DOMException && pollError.name === "AbortError") return;
      }
      if (p.count >= MAX_POLLS) {
        setActiveJobId(null);
        setNotice("The video is taking longer than usual. Reopen this chapter later to check on it.");
        return;
      }
      p.timer = window.setTimeout(() => void tick(), STUDY_VIDEO_POLL_MS);
    };
    pollRef.current.timer = window.setTimeout(() => void tick(), 1500);
  }, [refresh, stopPolling]);

  useEffect(() => {
    stopPolling();
    setVersions([]);
    setSelectedId(null);
    setActiveJobId(null);
    setProgress(null);
    setError("");
    setNotice("");
    // Load saved versions only; resume watching an in-flight job but never start one on page load.
    void refresh().then((result) => {
      if (result?.active) {
        setProgress(result.active.progress);
        if (result.active.status === "generating") poll(result.active.id);
      }
    });
    return stopPolling;
  }, [refresh, poll, stopPolling]);

  const createVideo = useCallback(async () => {
    if (!args.versionId || !args.insights || busy || activeJobId) return;
    setError("");
    setNotice("");
    setBusy(true);
    try {
      const guideHash = await hashInsightsForImage(args.insights);
      const reservation = await reserveStudyVideoJob(args.versionId, args.passage, guideHash);
      if (!reservation.created) {
        setNotice("A video aid for this chapter is already being created. No duplicate was started.");
        if (reservation.status === "generating") poll(reservation.id);
        return;
      }
      setProgress(0);
      await startStudyVideo({ jobId: reservation.id, passage: args.passage, versionId: Number(args.versionId), guideHash, reference: args.label });
      poll(reservation.id);
    } catch (createError) {
      setActiveJobId(null);
      setError(createError instanceof Error ? createError.message : "The video aid could not be started.");
    } finally {
      setBusy(false);
    }
  }, [activeJobId, args.insights, args.label, args.passage, args.versionId, busy, poll]);

  const cancelVideo = useCallback(async () => {
    const jobId = activeJobId;
    if (!jobId) return;
    stopPolling();
    setActiveJobId(null);
    setProgress(null);
    await cancelStudyVideo(jobId).catch(() => undefined);
    setNotice("Video aid cancelled. The provider may already have started rendering, so a charge may still apply.");
  }, [activeJobId, stopPolling]);

  const chooseVersion = useCallback(async (version: StudyVideoVersion) => {
    try {
      await selectStudyVideo(version.id);
      setVersions((current) => [version, ...current.filter((item) => item.id !== version.id)]);
      setSelectedId(version.id);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "The video version could not be selected.");
    }
  }, []);

  const selected = versions.find((item) => item.id === selectedId) ?? versions[0] ?? null;
  return { versions, selected, selectedId, generating: busy || Boolean(activeJobId), progress, error, notice, createVideo, cancelVideo, chooseVersion };
}
