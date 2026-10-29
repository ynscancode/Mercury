import { describe, expect, it } from 'vitest';
import { readSupabaseConfig } from './env';

const VALID_KEY = 'a'.repeat(60);

describe('readSupabaseConfig', () => {
  it('accepts a complete configuration', () => {
    const result = readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co',
      VITE_SUPABASE_ANON_KEY: VALID_KEY,
    });
    expect(result).toEqual({
      ok: true,
      config: { url: 'https://abcdefgh.supabase.co', anonKey: VALID_KEY },
    });
  });

  it('trims surrounding whitespace, which pasting tends to add', () => {
    const result = readSupabaseConfig({
      VITE_SUPABASE_URL: '  https://abcdefgh.supabase.co  ',
      VITE_SUPABASE_ANON_KEY: `\n${VALID_KEY}\n`,
    });
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.config.url).toBe('https://abcdefgh.supabase.co');
  });

  it('reports both values when nothing is configured', () => {
    const result = readSupabaseConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems).toHaveLength(2);
  });

  it('treats an empty string as unset rather than valid', () => {
    const result = readSupabaseConfig({
      VITE_SUPABASE_URL: '   ',
      VITE_SUPABASE_ANON_KEY: VALID_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain('is not set');
  });

  it('catches a project ref pasted in place of the URL', () => {
    const result = readSupabaseConfig({
      VITE_SUPABASE_URL: 'abcdefgh',
      VITE_SUPABASE_ANON_KEY: VALID_KEY,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain('full project URL');
  });

  it('catches a truncated anon key', () => {
    const result = readSupabaseConfig({
      VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co',
      VITE_SUPABASE_ANON_KEY: 'too-short',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems[0]).toContain('too short');
  });
});
