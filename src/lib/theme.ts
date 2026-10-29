/**
 * Appearance preference: follow the device, or pin light or dark.
 *
 * This is stored per device in localStorage rather than in the user's Supabase
 * settings, which is deliberate and matches the artifact: a phone used at night
 * and a laptop used at a desk reasonably want different answers, so syncing the
 * choice between them would be a downgrade. It is also the kind of value that
 * can safely come back empty — the fallback is 'auto', which is what someone
 * who never opened the setting would get anyway.
 */
export type ThemePreference = 'auto' | 'light' | 'dark';

export const THEME_STORAGE_KEY = 'phaestos.theme';

/** Anything with a `dataset`, so this is testable without a DOM. */
export interface ThemeTarget {
  dataset: { theme?: string };
}

/** Minimal slice of the Storage API, so a stub or a throwing stub can stand in. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export function normalizeTheme(
  value: string | null | undefined,
): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/**
 * 'auto' removes the attribute entirely rather than setting a value, so the
 * `prefers-color-scheme` rules in tokens.css take over. Setting data-theme
 *="auto" would match neither theme selector and strand the page in light.
 */
export function applyTheme(pref: ThemePreference, root: ThemeTarget): void {
  if (pref === 'auto') delete root.dataset.theme;
  else root.dataset.theme = pref;
}

export function readStoredTheme(
  storage: ThemeStorage | undefined,
): ThemePreference {
  if (!storage) return 'auto';
  try {
    return normalizeTheme(storage.getItem(THEME_STORAGE_KEY));
  } catch {
    // Private browsing and blocked site data both throw on access.
    return 'auto';
  }
}

export function storeTheme(
  pref: ThemePreference,
  storage: ThemeStorage | undefined,
): void {
  if (!storage) return;
  try {
    storage.setItem(THEME_STORAGE_KEY, pref);
  } catch {
    // A failed write must not stop the theme being applied for this session.
  }
}
