/** Shared, browser-safe AI access error contract. Server messages and the Reader's classification use the same strings. */
export const AI_MESSAGES = {
  signIn: "Sign in in Settings to use AI study tools.",
  sessionExpired: "Your session has expired. Sign in again to use AI study tools.",
  unavailable: "AI access could not be verified. Please try again.",
  dayLimit: "You have reached today’s AI study limit. Please continue with Scripture, notes, and reflection for now.",
  hourLimit: "AI study tools have been used frequently this hour. Please wait a little and try again.",
} as const;

export type AiErrorKind = "auth" | "quota" | "retry";

export function aiErrorKind(message: string): AiErrorKind {
  if (message === AI_MESSAGES.signIn || message === AI_MESSAGES.sessionExpired || /sign in/i.test(message)) return "auth";
  if (message === AI_MESSAGES.dayLimit || message === AI_MESSAGES.hourLimit || /limit|this hour/i.test(message)) return "quota";
  return "retry";
}
