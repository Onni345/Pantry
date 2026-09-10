import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const isConfigured = Boolean(url && anonKey);

if (!isConfigured) {
  console.warn(
    'Supabase is not configured. Copy .env.example to .env and fill in ' +
      'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY, then restart the dev server.'
  );
}

export const supabase = isConfigured
  ? createClient(url, anonKey, {
      auth: {
        // Keeps the anonymous session alive indefinitely so the user never
        // sees a login screen again after onboarding.
        persistSession: true,
        autoRefreshToken: true
      }
    })
  : null;
