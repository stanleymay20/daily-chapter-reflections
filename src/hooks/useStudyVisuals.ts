import { useCallback, useEffect, useRef, useState } from "react";

import type { StudyInsights } from "@/lib/insights.functions";
import {
  hashInsightsForImage,
  loadStudyImages,
  markStudyImageJob,
  persistStudyImage,
  reserveStudyImageJob,
  selectStudyImage,
  type StudyImageVersion,
} from "@/lib/study-media.client";
import { streamImage } from "@/lib/stream-image";

export function useStudyVisuals(args: {
  passage: string;
  versionId?: string;
  label: string;
  insights: StudyInsights | null;
}) {
  const [versions, setVersions] = useState<StudyImageVersion[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [preview, setPreview] = useState("");
  const [previewFinal, setPreviewFinal] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const refresh = useCallback(async (silent = false) => {
    if (!args.versionId) {
      setVersions([]);
      setSelectedId(null);
      return;
    }
    try {
      const next = await loadStudyImages(args.versionId, args.passage);
      setVersions(next);
      setSelectedId(next[0]?.id ?? null);
      if (!silent) setError("");
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : "Saved chapter pictures could not be loaded.";
      if (!silent && !message.startsWith("Sign in")) setError(message);
    }
  }, [args.passage, args.versionId]);

  useEffect(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    setVersions([]);
    setSelectedId(null);
    setPreview("");
    setPreviewFinal(false);
    setGenerating(false);
    setError("");
    setNotice("");
    void refresh(true);
    return () => abortRef.current?.abort();
  }, [refresh]);

  const selected = versions.find((item) => item.id === selectedId) ?? versions[0] ?? null;
  const image = preview || selected?.url || "";
  const imageFinal = preview ? previewFinal : Boolean(selected?.url);

  const createVisual = useCallback(async () => {
    if (!args.versionId || !args.insights || generating) return;
    setError("");
    setNotice("");
    let jobId = "";
    try {
      const guideHash = await hashInsightsForImage(args.insights);
      const reservation = await reserveStudyImageJob(args.versionId, args.passage, guideHash);
      jobId = reservation.id;
      if (!reservation.created) {
        setNotice("This chapter picture is already being generated in another tab or device. No duplicate generation was started.");
        window.setTimeout(() => void refresh(true), 2500);
        return;
      }

      const controller = new AbortController();
      abortRef.current = controller;
      setGenerating(true);
      setPreview("");
      setPreviewFinal(false);
      let finalDataUrl = "";

      await streamImage(
        "/api/generate-study-image",
        {
          jobId,
          passage: args.passage,
          versionId: Number(args.versionId),
          guideHash,
          reference: args.label,
        },
        (dataUrl, isFinal) => {
          setPreview(dataUrl);
          setPreviewFinal(isFinal);
          if (isFinal) finalDataUrl = dataUrl;
        },
        controller.signal,
      );

      if (controller.signal.aborted) throw new DOMException("Generation cancelled", "AbortError");
      if (!finalDataUrl) throw new Error("The image provider did not return a completed picture.");

      const saved = await persistStudyImage({
        jobId,
        versionId: args.versionId,
        passage: args.passage,
        guideHash,
        dataUrl: finalDataUrl,
      });
      setVersions((current) => [saved, ...current.filter((item) => item.id !== saved.id)]);
      setSelectedId(saved.id);
      setPreview("");
      setPreviewFinal(false);
      setNotice("Picture saved. It will now return after reload and on your other signed-in devices.");
    } catch (generationError) {
      const aborted = generationError instanceof DOMException && generationError.name === "AbortError";
      if (jobId) {
        await markStudyImageJob(
          jobId,
          aborted ? "cancelled" : "failed",
          aborted ? "Cancelled by the user." : generationError instanceof Error ? generationError.message : "Image generation failed.",
        ).catch(() => undefined);
      }
      setPreview("");
      setPreviewFinal(false);
      if (aborted) {
        setNotice("Picture generation cancelled. If the provider had already started rendering, the provider charge may already have occurred.");
      } else {
        setError(generationError instanceof Error ? generationError.message : "The illustration could not be created.");
      }
    } finally {
      abortRef.current = null;
      setGenerating(false);
    }
  }, [args.insights, args.label, args.passage, args.versionId, generating, refresh]);

  const cancelVisual = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
  }, []);

  const chooseVersion = useCallback(async (version: StudyImageVersion) => {
    setError("");
    try {
      await selectStudyImage(version.id);
      const selectedAt = new Date().toISOString();
      setVersions((current) => [
        { ...version, selectedAt },
        ...current.filter((item) => item.id !== version.id),
      ]);
      setSelectedId(version.id);
      setPreview("");
      setPreviewFinal(false);
    } catch (selectError) {
      setError(selectError instanceof Error ? selectError.message : "The picture version could not be selected.");
    }
  }, []);

  return {
    versions,
    selectedId,
    selected,
    image,
    imageFinal,
    generating,
    error,
    notice,
    createVisual,
    cancelVisual,
    chooseVersion,
    refresh,
  };
}
