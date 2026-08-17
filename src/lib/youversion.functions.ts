import { createServerFn } from "@tanstack/react-start";

import { isValidPassageId, isValidVersionId, encodeApiError, normalizeApiError } from "./youversion";

export const listBiblesFn = createServerFn({ method: "GET" }).handler(async () => {
  const { listBibles } = await import("./youversion.server");
  const bibles = await listBibles();
  return { bibles };
});

export const getPassageFn = createServerFn({ method: "GET" })
  .inputValidator((input: { versionId: string; passage: string }) => {
    if (!isValidVersionId(input.versionId)) {
      throw new Error(encodeApiError(normalizeApiError(400, "Invalid translation id.")));
    }
    if (!isValidPassageId(input.passage)) {
      throw new Error(encodeApiError(normalizeApiError(400, "Invalid passage identifier.")));
    }
    return input;
  })
  .handler(async ({ data }) => {
    const { getPassage } = await import("./youversion.server");
    return await getPassage(data.versionId, data.passage);
  });
