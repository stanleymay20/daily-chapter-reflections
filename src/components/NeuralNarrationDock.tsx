import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Headphones, Loader2, Pause, Play, RotateCcw, Sparkles } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { pickDefaultVersion, useSelectedVersion } from "@/hooks/useReadingState";
import { generateNarrationFn } from "@/lib/narration.functions";
import { getPassageFn, listBiblesFn } from "@/lib/youversion.functions";

function passageFromPath() {
  if (typeof window === "undefined") return "";
  const match = window.location.pathname.match(/^\/read\/([^/]+)/);
  return match ? decodeURIComponent(match[1]!) : "";
}

export function NeuralNarrationDock() {
  const passage = passageFromPath();
  const { versionId, ready } = useSelectedVersion();
  const listBibles = useServerFn(listBiblesFn);
  const getPassage = useServerFn(getPassageFn);
  const generateNarration = useServerFn(generateNarrationFn);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [src, setSrc] = useState("");
  const [playing, setPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const biblesQuery = useQuery({
    queryKey: ["bibles", "english"],
    queryFn: async () => {
      const result = await listBibles();
      if (!result.ok) throw new Error(result.error.message);
      return Array.isArray(result.bibles) ? result.bibles : [];
    },
    enabled: Boolean(passage),
    staleTime: 3_600_000,
  });
  const active = useMemo(() => ready ? pickDefaultVersion(biblesQuery.data ?? [], versionId) : undefined, [biblesQuery.data, ready, versionId]);
  const passageQuery = useQuery({
    queryKey: ["passage", active?.id, passage],
    queryFn: async () => {
      if (!active) throw new Error("No Bible translation is selected.");
      const result = await getPassage({ data: { versionId: active.id, passage } });
      if (!result.ok) throw new Error(result.error.message);
      return result.passage;
    },
    enabled: Boolean(passage && active?.id),
    staleTime: 3_600_000,
  });

  useEffect(() => () => { if (src) URL.revokeObjectURL(src); }, [src]);
  if (!passage) return null;

  const buildNarration = async () => {
    if (!passageQuery.data || loading) return;
    setLoading(true); setError("");
    const text = passageQuery.data.verses.map(v => v.text).join(" ");
    const result = await generateNarration({ data: { text } });
    setLoading(false);
    if (!result.ok) { setError(result.error); return; }
    if (src) URL.revokeObjectURL(src);
    const binary = atob(result.audioBase64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    const nextSrc = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
    setSrc(nextSrc);
    window.setTimeout(() => audioRef.current?.play().catch(() => undefined), 50);
  };

  const toggle = () => {
    const audio = audioRef.current;
    if (!audio) { void buildNarration(); return; }
    if (audio.paused) void audio.play(); else audio.pause();
  };

  return <div className="fixed bottom-20 right-3 z-40 w-[min(24rem,calc(100vw-1.5rem))] sm:right-5">
    {!open ? <Button className="ml-auto flex rounded-full shadow-lg" onClick={() => setOpen(true)}><Headphones className="mr-2 size-4"/>Studio audio</Button> :
    <Card className="overflow-hidden border-primary/20 bg-background/95 shadow-2xl backdrop-blur">
      <div className="flex items-center justify-between gap-3 p-3">
        <div className="min-w-0"><p className="flex items-center gap-1.5 text-sm font-semibold"><Sparkles className="size-4 text-primary"/>Studio narration</p><p className="truncate text-[11px] text-muted-foreground">Natural neural voice · chapter audio</p></div>
        <button className="text-xs text-muted-foreground" onClick={() => setOpen(false)}>Hide</button>
      </div>
      <div className="border-t p-3">
        <audio ref={audioRef} src={src || undefined} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} preload="metadata" />
        <div className="flex items-center gap-2">
          <Button size="icon" onClick={toggle} disabled={loading || !passageQuery.data}>{loading ? <Loader2 className="size-4 animate-spin"/> : playing ? <Pause className="size-4"/> : <Play className="size-4"/>}</Button>
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{passageQuery.data?.reference || passage}</p><p className="text-[11px] text-muted-foreground">{src ? "Ready · tap play/pause" : loading ? "Creating studio-quality narration…" : "Tap play to generate this chapter"}</p></div>
          {src ? <Button size="icon" variant="ghost" onClick={() => { if (audioRef.current) audioRef.current.currentTime = 0; }} aria-label="Restart"><RotateCcw className="size-4"/></Button> : null}
        </div>
        {error ? <div className="mt-3 rounded-lg bg-muted p-2 text-xs"><p>{error}</p>{error.includes("not configured") ? <p className="mt-1 text-muted-foreground">Add ELEVENLABS_API_KEY to the deployment secrets. The existing device voice remains available in the reader until then.</p> : null}</div> : null}
        <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">Generated audio is a narration of the Scripture text already loaded from YouVersion. The API key stays server-side and is never exposed to the browser.</p>
      </div>
    </Card>}
  </div>;
}
