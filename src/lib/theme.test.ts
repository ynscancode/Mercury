import { describe, expect, it } from 'vitest';
import {
  applyTheme,
  normalizeTheme,
  readStoredTheme,
  storeTheme,
  THEME_STORAGE_KEY,
  type ThemeStorage,
  type ThemeTarget,
} from './theme';

const target = (): ThemeTarget => ({ dataset: {} });

function memoryStorage(initial: Record<string, string> = {}): ThemeStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

const throwingStorage: ThemeStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('blocked');
  },
};

describe('normalizeTheme', () => {
  it('passes through the two pinned values', () => {
    expect(normalizeTheme('light')).toBe('light');
    expect(normalizeTheme('dark')).toBe('dark');
  });

  it('falls back to auto for anything else', () => {
    for (const v of [null, undefined, '', 'auto', 'Dark', 'system', 'true']) {
      expect(normalizeTheme(v)).toBe('auto');
    }
  });
});

describe('applyTheme', () => {
  it('pins light and dark on the data attribute', () => {
    const el = target();
    applyTheme('dark', el);
    expect(el.dataset.theme).toBe('dark');
    applyTheme('light', el);
    expect(el.dataset.theme).toBe('light');
  });

  // Setting data-theme="auto" would match neither CSS selector and strand the
  // page in light while the device is dark, so auto must remove the attribute.
  it('removes the attribute for auto rather than setting a value', () => {
    const el = target();
    applyTheme('dark', el);
    applyTheme('auto', el);
    expect('theme' in el.dataset).toBe(false);
  });
});

describe('readStoredTheme', () => {
  it('reads a stored preference', () => {
    expect(
      readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'dark' })),
    ).toBe('dark');
  });

  it('defaults to auto when nothing is stored', () => {
    expect(readStoredTheme(memoryStorage())).toBe('auto');
  });

  it('defaults to auto when storage is unavailable', () => {
    expect(readStoredTheme(undefined)).toBe('auto');
  });

  it('survives storage that throws, as in private browsing', () => {
    expect(readStoredTheme(throwingStorage)).toBe('auto');
  });

  it('ignores a corrupted stored value', () => {
    expect(
      readStoredTheme(memoryStorage({ [THEME_STORAGE_KEY]: 'neon' })),
    ).toBe('auto');
  });
});

describe('storeTheme', () => {
  it('round-trips a preference', () => {
    const s = memoryStorage();
    storeTheme('light', s);
    expect(readStoredTheme(s)).toBe('light');
  });

  it('does not throw when storage refuses the write', () => {
    expect(() => storeTheme('dark', throwingStorage)).not.toThrow();
    expect(() => storeTheme('dark', undefined)).not.toThrow();
  });
});
