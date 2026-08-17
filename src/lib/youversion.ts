/**
 * Client-safe YouVersion Platform types and error normalization.
 * No API key or network access lives in this file.
 */

export type BibleVersion = {
  id: string;
  name: string;
  abbreviation: string;
  language: string;
  copyright: string;
};

export type PassageResult = {
  reference: string;
  versionId: string;
  versionName: string;
  copyright: string;
  /** Ordered verses of the chapter. */
  verses: { number: string; text: string }[];
};

export type ApiErrorKind =
  | "missing_key"
  | "unauthorized"
  | "not_found"
  | "rate_limited"
  | "timeout"
  | "server_error"
  | "invalid_request"
  | "network"
  | "unknown";

export type NormalizedApiError = {
  kind: ApiErrorKind;
  status: number | null;
  message: string;
  retryable: boolean;
};

export const MISSING_KEY_MESSAGE = "Connect YouVersion App Key in project secrets";

export function normalizeApiError(status: number | null, detail?: string): NormalizedApiError {
  if (status === 403) {
    return {
      kind: "unauthorized",
      status,
      message:
        "This YouVersion App Key has no Bible translations granted yet. Request Bible access for your app in the YouVersion Platform developer portal, then retry.",
      retryable: false,
    };
  }
  if (status === 401) {
    return {
      kind: "unauthorized",
      status,
      message: "The YouVersion App Key was rejected. Check the key in project secrets.",
      retryable: false,
    };
  }
  if (status === 404) {
    return {
      kind: "not_found",
      status,
      message: "This passage or translation is not available for this app key.",
      retryable: false,
    };
  }
  if (status === 429) {
    return {
      kind: "rate_limited",
      status,
      message: "Too many requests to YouVersion. Please wait a moment and retry.",
      retryable: true,
    };
  }
  if (status === 408) {
    return {
      kind: "timeout",
      status,
      message: "YouVersion took too long to respond.",
      retryable: true,
    };
  }
  if (status !== null && status >= 500) {
    return {
      kind: "server_error",
      status,
      message: "YouVersion is having trouble right now. Please retry shortly.",
      retryable: true,
    };
  }
  if (status !== null && status >= 400) {
    return {
      kind: "invalid_request",
      status,
      message: detail || "The request to YouVersion was invalid.",
      retryable: false,
    };
  }
  return {
    kind: status === null ? "network" : "unknown",
    status,
    message: detail || "Could not reach YouVersion.",
    retryable: true,
  };
}

export function isMissingKeyError(error: unknown): boolean {
  return error instanceof Error && error.message.includes(MISSING_KEY_MESSAGE);
}

/** Encode a normalized error into an Error message that survives the RPC boundary. */
export function encodeApiError(err: NormalizedApiError): string {
  return `YVP_ERROR:${JSON.stringify(err)}`;
}

export function decodeApiError(error: unknown): NormalizedApiError {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes(MISSING_KEY_MESSAGE)) {
    return { kind: "missing_key", status: null, message: MISSING_KEY_MESSAGE, retryable: false };
  }
  const marker = msg.indexOf("YVP_ERROR:");
  if (marker >= 0) {
    try {
      const parsed = JSON.parse(msg.slice(marker + "YVP_ERROR:".length)) as NormalizedApiError;
      if (parsed && typeof parsed.kind === "string") return parsed;
    } catch {
      /* fall through */
    }
  }
  return normalizeApiError(null, msg);
}

/** Validate a version id: digits only (YouVersion Bible ids). */
export function isValidVersionId(id: string): boolean {
  return /^[0-9]{1,6}$/.test(id);
}

/** Validate a USFM chapter passage identifier, e.g. GEN.42 or 1CO.14 */
export function isValidPassageId(id: string): boolean {
  return /^[1-9A-Z]{3}\.[0-9]{1,3}$/.test(id);
}
