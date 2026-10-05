import type { SavedSequence } from "./study-sequence";
import { cuesToVtt, SEQUENCE_LABEL } from "./study-sequence.shared";

export type ExportRightsStatus = "unknown" | "public-domain" | "licensed-for-export";
export type ExportAspect = "16:9" | "9:16";
export type ExportPreset = "study" | "kids-bible";

export type YouTubeExportPackage = {
  formatVersion: "youtube-study-package-v1";
  composition: "timeline-package";
  singleFileVideoAvailable: false;
  aspect: ExportAspect;
  preset: ExportPreset;
  reference: string;
  scripturePolicy: "references-only" | "quoted-scripture-permitted";
  disclosure: string;
  metadata: {
    title: string;
    description: string;
    thumbnailText: string;
    attribution: string;
  };
  captionsVtt: string;
  transcript: string;
  scenes: Array<{
    index: number;
    start: number;
    end: number;
    narration: string;
    visualBrief: string;
    visualUrl: string | null;
    narrationUrl: string;
  }>;
};

export function scriptureExportPolicy(rights: ExportRightsStatus) {
  return rights === "unknown" ? "references-only" as const : "quoted-scripture-permitted" as const;
}

function safeTitle(value: string) {
  return value.replace(/\s+/g, " ").trim().slice(0, 90) || "Bible chapter";
}

function narrationWithoutUnlicensedQuotes(text: string) {
  return text.replace(/[“\"][^”\"]{3,}[”\"]/g, "[Scripture quotation omitted — see chapter reference]");
}

export function buildYouTubeExportPackage(
  sequence: SavedSequence,
  reference: string,
  aspect: ExportAspect,
  rights: ExportRightsStatus,
  preset: ExportPreset = "study",
  attribution = "Bible text rights depend on the selected translation. Verify permission before external redistribution.",
): YouTubeExportPackage {
  const policy = scriptureExportPolicy(rights);
  const ref = safeTitle(reference);
  const assets = new Map(sequence.assets.map((asset) => [asset.index, asset]));
  const scenes = sequence.manifest.scenes.map((scene, index) => {
    const asset = assets.get(index);
    const narration = policy === "references-only" ? narrationWithoutUnlicensedQuotes(scene.narration) : scene.narration;
    return {
      index,
      start: scene.start,
      end: scene.end,
      narration,
      visualBrief: scene.visualBrief,
      visualUrl: asset?.visualUrl ?? null,
      narrationUrl: asset?.audioUrl ?? "",
    };
  });
  const transcript = scenes.map((scene) => scene.narration).join("\n\n");
  const title = preset === "kids-bible" ? `${ref} | Kids Bible Story` : `${ref} | Bible Chapter Study`;
  const description = [
    `A guide-grounded ${preset === "kids-bible" ? "Kids Bible" : "Bible study"} sequence for ${ref}.`,
    SEQUENCE_LABEL + ". Visuals are interpretive and are not historical footage.",
    policy === "references-only" ? "External Scripture quotation rights are unconfirmed, so this package uses chapter references rather than redistributing quoted Bible text." : "Scripture quotation is permitted only within the confirmed translation licence terms.",
    attribution,
  ].join("\n\n");
  return {
    formatVersion: "youtube-study-package-v1",
    composition: "timeline-package",
    singleFileVideoAvailable: false,
    aspect,
    preset,
    reference: ref,
    scripturePolicy: policy,
    disclosure: `${SEQUENCE_LABEL}. Not historical footage.`,
    metadata: {
      title,
      description,
      thumbnailText: ref,
      attribution,
    },
    captionsVtt: cuesToVtt(sequence.manifest.cues.map((cue) => ({ ...cue, text: policy === "references-only" ? narrationWithoutUnlicensedQuotes(cue.text) : cue.text }))),
    transcript,
    scenes,
  };
}
