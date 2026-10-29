import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { readSupabaseConfig, type ConfigResult } from './env';

export const configResult: ConfigResult = readSupabaseConfig(
  import.meta.env as unknown as Record<string, string | undefined>,
);

/**
 * Null when the project is not configured yet. The app renders setup
 * instructions in that case rather than throwing on import, so `npm run dev`
 * is useful before any Supabase project exists.
 */
export const supabase: SupabaseClient | null = configResult.ok
  ? createClient(configResult.config.url, configResult.config.anonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;
