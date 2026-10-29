import { useCallback, useEffect, useState } from 'react';
import {
  applyTheme,
  readStoredTheme,
  storeTheme,
  type ThemePreference,
} from '@/lib/theme';

const OPTIONS: ReadonlyArray<[ThemePreference, string]> = [
  ['auto', 'Match device'],
  ['light', 'Light'],
  ['dark', 'Dark'],
];

export function useTheme(): [ThemePreference, (next: ThemePreference) => void] {
  const [pref, setPref] = useState<ThemePreference>(() =>
    readStoredTheme(globalThis.localStorage),
  );

  // The inline script in index.html has already applied the stored value; this
  // keeps the DOM in step after a change and on first mount in dev.
  useEffect(() => {
    applyTheme(pref, document.documentElement);
  }, [pref]);

  const choose = useCallback((next: ThemePreference) => {
    storeTheme(next, globalThis.localStorage);
    setPref(next);
  }, []);

  return [pref, choose];
}

/** Moves into Settings in phase 3; it lives in the shell meanwhile. */
export function ThemeControl() {
  const [pref, choose] = useTheme();
  return (
    <div className="chips" role="group" aria-label="Appearance">
      {OPTIONS.map(([value, label]) => (
        <button
          key={value}
          type="button"
          className="chip"
          aria-pressed={pref === value}
          onClick={() => choose(value)}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
