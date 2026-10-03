import { createClient } from "@supabase/supabase-js";

import { publicSupabasePublishableKey, publicSupabaseUrl } from "@/integrations/supabase/public-config";

export const supabase = createClient(publicSupabaseUrl(), publicSupabasePublishableKey(), {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

export function requireSupabase() {
  return supabase;
}
