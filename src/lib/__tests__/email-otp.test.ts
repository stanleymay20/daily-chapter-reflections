import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { signInWithOtp: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(), signOut: vi.fn() };
vi.mock("../supabase", () => ({ requireSupabase: () => ({ auth }) }));

import { getCloudUser, normalizeOtp, otpErrorMessage, requestEmailCode, verifyEmailCode } from "../cloud-sync";

const src = (p: string) => readFileSync(resolve(__dirname, p), "utf8");

beforeEach(() => Object.values(auth).forEach((f) => f.mockReset()));

describe("email OTP sign-in", () => {
  it("requests a code without any redirect URL", async () => {
    auth.signInWithOtp.mockResolvedValue({ error: null });
    await requestEmailCode("  Me@Example.com ");
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: "me@example.com", options: { shouldCreateUser: true } });
    expect(JSON.stringify(auth.signInWithOtp.mock.calls[0])).not.toContain("emailRedirectTo");
  });

  it("rejects invalid email before calling auth", async () => {
    await expect(requestEmailCode("nope")).rejects.toThrow(/valid email/);
    expect(auth.signInWithOtp).not.toHaveBeenCalled();
  });

  it("resend calls signInWithOtp again and surfaces rate limits", async () => {
    auth.signInWithOtp.mockResolvedValueOnce({ error: null }).mockResolvedValueOnce({ error: { status: 429, message: "rate limit" } });
    await requestEmailCode("me@example.com");
    await expect(requestEmailCode("me@example.com")).rejects.toThrow(/wait a minute/);
    expect(auth.signInWithOtp).toHaveBeenCalledTimes(2);
  });

  it("verifies with type email in the same client and returns the session", async () => {
    const session = { access_token: "a.b.c" };
    auth.verifyOtp.mockResolvedValue({ data: { session }, error: null });
    await expect(verifyEmailCode("Me@Example.com", "12 34-56")).resolves.toBe(session);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "me@example.com", token: "123456", type: "email" });
  });

  it("maps invalid/expired codes to a clear message", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { code: "otp_expired", message: "Token has expired or is invalid" } });
    await expect(verifyEmailCode("me@example.com", "000000")).rejects.toThrow(/invalid or has expired/);
    expect(otpErrorMessage({ message: "Token is invalid" })).toMatch(/invalid or has expired/);
  });

  it("refuses short codes without calling auth", async () => {
    await expect(verifyEmailCode("me@example.com", "123")).rejects.toThrow(/6-digit/);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(normalizeOtp("1a2b3c4d5e6f7")).toBe("123456");
  });

  it("restores signed-in state from the persisted session", async () => {
    auth.getUser.mockResolvedValue({ data: { user: { id: "u1", email: "me@example.com" } } });
    expect((await getCloudUser())?.email).toBe("me@example.com");
  });

  it("no app code relies on cross-browser magic-link redirects", () => {
    for (const p of ["../cloud-sync.ts", "../../routes/settings.tsx", "../../routes/community.tsx", "../../components/EmailCodeSignIn.tsx"]) {
      expect(src(p)).not.toContain("emailRedirectTo");
    }
    expect(src("../../routes/community.tsx")).toContain("EmailCodeSignIn");
    expect(src("../../routes/settings.tsx")).toContain("EmailCodeSignIn");
    expect(src("../../components/EmailCodeSignIn.tsx")).toContain('autoComplete="one-time-code"');
  });
});
