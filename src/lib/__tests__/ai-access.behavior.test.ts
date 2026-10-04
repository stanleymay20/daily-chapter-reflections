import { afterEach, describe, expect, it, vi } from "vitest";

import { authorizeAiRequest } from "../ai-access.server";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function request(token?: string) {
  return new Request("https://example.test/ai", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function fetchCalls(fetchMock: ReturnType<typeof vi.fn>) {
  return fetchMock.mock.calls as unknown as Array<[RequestInfo | URL, RequestInit | undefined]>;
}

describe("authorizeAiRequest", () => {
  it("rejects unauthenticated paid AI requests before any upstream call", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizeAiRequest(request(), "insights")).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects an invalid or expired Supabase access token", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ message: "invalid token" }, 401));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizeAiRequest(request("bad-token"), "ask_chapter")).resolves.toMatchObject({
      ok: false,
      status: 401,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchCalls(fetchMock)[0]?.[0])).toContain("/auth/v1/user");
  });

  it("fails closed when Supabase Auth infrastructure cannot verify the session", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ message: "upstream unavailable" }, 503));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizeAiRequest(request("signed-token"), "study_memory")).resolves.toMatchObject({
      ok: false,
      status: 503,
      error: expect.stringContaining("could not be verified"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the database quota RPC is unavailable", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "user-123" }))
      .mockResolvedValueOnce(jsonResponse({ message: "function unavailable" }, 404));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizeAiRequest(request("signed-token"), "narration")).resolves.toMatchObject({
      ok: false,
      status: 503,
      error: expect.stringContaining("could not be verified"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchCalls(fetchMock)[1]?.[0])).toContain("/rest/v1/rpc/consume_ai_quota");
  });

  it("allows a verified user only after the database quota RPC permits the feature", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "user-verified" }))
      .mockResolvedValueOnce(jsonResponse({ allowed: true, hourRemaining: 5, dayRemaining: 14 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizeAiRequest(request("signed-token"), "image")).resolves.toEqual({
      ok: true,
      userId: "user-verified",
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const calls = fetchCalls(fetchMock);
    const authHeaders = new Headers(calls[0]?.[1]?.headers);
    const quotaHeaders = new Headers(calls[1]?.[1]?.headers);
    expect(authHeaders.get("Authorization")).toBe("Bearer signed-token");
    expect(quotaHeaders.get("Authorization")).toBe("Bearer signed-token");
  });

  it("propagates database-enforced rate limits without calling a paid provider", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ id: "user-rate-limited" }))
      .mockResolvedValueOnce(jsonResponse({ allowed: false, scope: "hour", retryAfter: 317 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(authorizeAiRequest(request("signed-token"), "insights")).resolves.toMatchObject({
      ok: false,
      status: 429,
      retryAfter: 317,
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
