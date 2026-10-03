// Supabase project URL, project ID, and publishable key are public client
// configuration, not secrets. Keeping a checked-in fallback prevents preview
// and production builds from depending on a tracked .env file while still
// allowing deployment-specific VITE_* overrides.
export const DEFAULT_SUPABASE_PROJECT_ID = "xjvtpiyyfabuxgtdvynu";
export const DEFAULT_SUPABASE_URL = "https://xjvtpiyyfabuxgtdvynu.supabase.co";
export const DEFAULT_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_A61HXEHQN_6ndWRHwuqGaA_HFtKdjvU";

export function publicSupabaseUrl(): string {
  return import.meta.env["VITE_SUPABASE_URL"] || DEFAULT_SUPABASE_URL;
}

export function publicSupabasePublishableKey(): string {
  return import.meta.env["VITE_SUPABASE_PUBLISHABLE_KEY"] || DEFAULT_SUPABASE_PUBLISHABLE_KEY;
}

export function publicSupabaseProjectId(): string {
  return import.meta.env["VITE_SUPABASE_PROJECT_ID"] || DEFAULT_SUPABASE_PROJECT_ID;
}
