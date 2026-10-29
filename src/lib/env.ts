/**
 * Reading the Supabase configuration is kept as a pure function over a plain
 * record so it can be tested without touching `import.meta.env`, and so the
 * two mistakes that actually happen during setup — leaving a value blank, and
 * pasting the project ref where the URL belongs — produce a message that says
 * which one it was rather than a blank screen.
 */
export interface SupabaseConfig {
  url: string;
  anonKey: string;
}

export type ConfigResult =
  { ok: true; config: SupabaseConfig } | { ok: false; problems: string[] };

type EnvRecord = Record<string, string | undefined>;

const URL_KEY = 'VITE_SUPABASE_URL';
const KEY_KEY = 'VITE_SUPABASE_ANON_KEY';

export function readSupabaseConfig(env: EnvRecord): ConfigResult {
  const problems: string[] = [];
  const url = (env[URL_KEY] ?? '').trim();
  const anonKey = (env[KEY_KEY] ?? '').trim();

  if (!url) {
    problems.push(`${URL_KEY} is not set.`);
  } else if (!/^https?:\/\//.test(url)) {
    problems.push(
      `${URL_KEY} must be the full project URL starting with https:// — got "${url}".`,
    );
  }

  if (!anonKey) {
    problems.push(`${KEY_KEY} is not set.`);
  } else if (anonKey.length < 40) {
    problems.push(
      `${KEY_KEY} looks too short to be a real key (${anonKey.length} characters).`,
    );
  }

  if (problems.length > 0) return { ok: false, problems };
  return { ok: true, config: { url, anonKey } };
}
