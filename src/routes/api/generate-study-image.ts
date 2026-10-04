import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { generateImage, imageSettings } from "@/lib/image-gateway.server";
import { claimOwnedImageJob, loadOwnedVisualGuide, markImageJobFromRequest } from "@/lib/study-media.server";

const requestSchema = z.object({
  jobId: z.string().uuid(),
  passage: z.string().regex(/^[1-3]?[A-Z]{2,3}\.[0-9]{1,3}$/),
  versionId: z.number().int().positive(),
  guideHash: z.string().regex(/^[0-9a-f]{64}$/),
  reference: z.string().trim().min(1).max(120),
});

export const Route = createFileRoute("/api/generate-study-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: z.infer<typeof requestSchema>;
        try {
          input = requestSchema.parse(await request.json());
        } catch {
          return Response.json({ message: "The saved chapter guide is not ready for an illustration." }, { status: 400 });
        }

        const apiKey = process.env["LOVABLE_API_KEY"];
        if (!apiKey) return Response.json({ message: "AI study tools are not configured on this deployment." }, { status: 500 });

        const { authorizeAiRequest } = await import("@/lib/ai-access.server");
        const access = await authorizeAiRequest(request, "image");
        if (!access.ok) {
          const init: ResponseInit = { status: access.status };
          if (access.retryAfter) init.headers = { "Retry-After": String(access.retryAfter) };
          return Response.json({ message: access.error }, init);
        }

        const guideResult = await loadOwnedVisualGuide(request, input.passage, input.versionId, input.guideHash);
        if (!guideResult.ok) return Response.json({ message: guideResult.error }, { status: guideResult.status });

        const claim = await claimOwnedImageJob(request, {
          jobId: input.jobId,
          userId: access.userId,
          passage: input.passage,
          versionId: input.versionId,
          guideHash: input.guideHash,
        });
        if (!claim.ok) return Response.json({ message: claim.error }, { status: claim.status });

        const guide = guideResult.value;
        const prompt = `Create one calm, historically respectful editorial illustration for a private Bible study guide about ${input.reference}.

Persisted chapter guide summary: ${guide.summary}
Events explicitly identified in the persisted chapter guide:
${guide.eventSequence.map((event, index) => `${index + 1}. ${event}`).join("\n")}

Show a single coherent scene that represents the chapter's central event. Painterly realism, natural earth pigments, soft daylight, tactile linen and stone textures, wide landscape composition with clear focal depth. Avoid sensationalism. Do not add supernatural effects unless explicitly named above. Do not invent maps, architecture, weapons, clothing insignia, named individuals, or historical details not supported by the persisted guide. No words, letters, verse text, captions, borders, UI, or typography in the image. This is interpretive study artwork, never a depiction presented as Scripture.`;

        try {
          const upstream = await generateImage({ ...imageSettings, apiKey }, prompt, true, request.signal);
          if (!upstream.ok) {
            await markImageJobFromRequest(request, input.jobId, "failed", `Image provider returned HTTP ${upstream.status}.`);
          }
          const headers = new Headers({
            "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
            "Cache-Control": "no-store",
          });
          upstream.headers.forEach((value, name) => {
            if (name.toLowerCase().startsWith("x-lovable-aig-")) headers.set(name, value);
          });
          return new Response(upstream.body, { status: upstream.status, headers });
        } catch (error) {
          const aborted = error instanceof Error && error.name === "AbortError";
          await markImageJobFromRequest(
            request,
            input.jobId,
            aborted ? "cancelled" : "failed",
            aborted ? "Generation cancelled by the user." : error instanceof Error ? error.message : "Image provider request failed.",
          );
          if (aborted) return new Response(null, { status: 499 });
          return Response.json({ message: "The image provider could not complete this illustration." }, { status: 502 });
        }
      },
    },
  },
});
