import { createFileRoute } from "@tanstack/react-router";

import { handleAdvance, jobSchema, json } from "@/lib/study-sequence-routes.server";

/** Runs one bounded pipeline step for an owned, generating study sequence. */
export const Route = createFileRoute("/api/study-video/advance")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const parsed = jobSchema.safeParse(await request.json().catch(() => null));
        if (!parsed.success) return json("Invalid study video job.", 400);
        return handleAdvance(request, parsed.data);
      },
    },
  },
});
