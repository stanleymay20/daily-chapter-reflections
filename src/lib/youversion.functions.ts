import { createServerFn } from "@tanstack/react-start";

import {
  decodeApiError,
  isValidPassageId,
  isValidVersionId,
  normalizeApiError,
  type BibleVersion,
  type NormalizedApiError,
  type PassageResult,
} from "./youversion";

export type BiblesResponse =
  | { ok: true; bibles: BibleVersion[] }
  | { ok: false; error: NormalizedApiError };

export type PassageResponse =
  | { ok: true; passage: PassageResult }
  | { ok: false; error: NormalizedApiError };

export const listBiblesFn = createServerFn({ method: "GET" }).handler(
  async (): Promise<BiblesResponse> => {
    try {
      const { listBibles } = await import("./youversion.server");
      return { ok: true, bibles: await listBibles() };
    } catch (err) {
      return { ok: false, error: decodeApiError(err) };
    }
  },
);

export const getPassageFn = createServerFn({ method: "GET" })
  .inputValidator((input: { versionId: string; passage: string }) => input)
  .handler(async ({ data }): Promise<PassageResponse> => {
    if (!isValidVersionId(data.versionId)) {
      return { ok: false, error: normalizeApiError(400, "Invalid translation id.") };
    }
    if (!isValidPassageId(data.passage)) {
      return { ok: false, error: normalizeApiError(400, "Invalid passage identifier.") };
    }
    try {
      const { getPassage } = await import("./youversion.server");
      return { ok: true, passage: await getPassage(data.versionId, data.passage) };
    } catch (err) {
      return { ok: false, error: decodeApiError(err) };
    }
  });
