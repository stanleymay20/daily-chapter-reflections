import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";

import { generateImage, imageSettings } from "@/lib/image-gateway.server";

const requestSchema = z.object({
  reference: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(1600),
  events: z.array(z.string().trim().min(1).max(320)).max(12),
});

export const Route = createFileRoute("/api/generate-study-image")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        let input: z.infer<typeof requestSchema>;
        try {
          input = requestSchema.parse(await request.json());
        } catch {
          return Response.json({ message: "The chapter guide is not ready for an illustration." }, { status: 400 });
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

        const prompt = `Create one calm, historically respectful editorial illustration for a private Bible study guide about ${input.reference}.

Chapter guide summary: ${input.summary}
Events explicitly identified in the supplied chapter guide:
${input.events.map((event, index) => `${index + 1}. ${event}`).join("\n")}

Show a single coherent scene that represents the chapter's central event. Painterly realism, natural earth pigments, soft daylight, tactile linen and stone textures, wide landscape composition with clear focal depth. Avoid sensationalism. Do not add supernatural effects unless explicitly named above. Do not invent maps, architecture, weapons, clothing insignia, named individuals, or historical details not supported by the guide. No words, letters, verse text, captions, borders, UI, or typography in the image. This is interpretive study artwork, never a depiction presented as Scripture.`;

        const upstream = await generateImage({ ...imageSettings, apiKey }, prompt, true);
        const headers = new Headers({
          "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
          "Cache-Control": "no-store",
        });
        upstream.headers.forEach((value, name) => {
          if (name.toLowerCase().startsWith("x-lovable-aig-")) headers.set(name, value);
        });
        return new Response(upstream.body, { status: upstream.status, headers });
      },
    },
  },
});