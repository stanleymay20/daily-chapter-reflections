import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const auth = { signInWithOtp: vi.fn(), verifyOtp: vi.fn(), getUser: vi.fn(), signOut: vi.fn() };
vi.mock("../supabase", () => ({ requireSupabase: () => ({ auth }) }));

import { OTP_LENGTH, isCompleteOtp, getCloudUser, normalizeOtp, otpErrorMessage, requestEmailCode, verifyEmailCode } from "../cloud-sync";

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
    await expect(verifyEmailCode("Me@Example.com", "1234 5678")).resolves.toBe(session);
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "me@example.com", token: "12345678", type: "email" });
  });

  it("maps invalid/expired codes to a clear message", async () => {
    auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: { code: "otp_expired", message: "Token has expired or is invalid" } });
    await expect(verifyEmailCode("me@example.com", "00000000")).rejects.toThrow(/invalid or has expired/);
    expect(otpErrorMessage({ message: "Token is invalid" })).toMatch(/invalid or has expired/);
  });

  it("refuses short codes without calling auth", async () => {
    await expect(verifyEmailCode("me@example.com", "123")).rejects.toThrow(/all 8 digits/);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    expect(normalizeOtp("1a2b3c4d5e6f7g8h9")).toBe("12345678");
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

  it("preserves an 8-digit code with a leading zero and sends it to verifyOtp in full", async () => {
    const session = { access_token: "t" };
    auth.verifyOtp.mockResolvedValue({ data: { session }, error: null });
    await verifyEmailCode("me@example.com", " 0123-4567 ");
    expect(auth.verifyOtp).toHaveBeenCalledWith({ email: "me@example.com", token: "01234567", type: "email" });
    expect(auth.verifyOtp.mock.calls[0]?.[0]?.token).toHaveLength(8);
  });

  it("can never truncate to six digits again", async () => {
    expect(OTP_LENGTH).toBe(8);
    expect(normalizeOtp("01234567")).toBe("01234567");
    expect(isCompleteOtp("012345")).toBe(false);
    await expect(verifyEmailCode("me@example.com", "012345")).rejects.toThrow(/all 8 digits/);
    expect(auth.verifyOtp).not.toHaveBeenCalled();
    const ui = src("../../components/EmailCodeSignIn.tsx");
    expect(ui).not.toMatch(/maxLength=\{6\}|\{6\}|6-digit|length !== 6/);
    expect(ui).toContain('autoComplete="one-time-code"');
    expect(ui).toContain('inputMode="numeric"');
    for (const p of ["../../routes/settings.tsx", "../../routes/community.tsx", "../../lib/email-templates/magic-link.tsx"]) {
      expect(src(p)).not.toMatch(/6-digit|six-digit/i);
    }
  });
});
