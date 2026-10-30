import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react';
import { Arabic, English, type TranslationKey } from './dictionary';

export type Locale = 'ar' | 'en';

const dictionaries: Record<Locale, Record<string, string>> = {
  ar: Arabic,
  en: English,
};

export const LOCALES: { id: Locale; label: string; dir: 'rtl' | 'ltr' }[] = [
  { id: 'ar', label: 'العربية', dir: 'rtl' },
  { id: 'en', label: 'English', dir: 'ltr' },
];

export type Translate = (key: TranslationKey, vars?: Record<string, string | number>) => string;

interface I18nContextValue {
  locale: Locale;
  dir: 'rtl' | 'ltr';
  t: Translate;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextValue | null>(null);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}

export function I18nProvider({
  locale,
  onLocaleChange,
  children,
}: {
  locale: Locale;
  onLocaleChange?: (locale: Locale) => void;
  children: ReactNode;
}) {
  const dir: 'rtl' | 'ltr' = locale === 'ar' ? 'rtl' : 'ltr';

  // Keep <html> in sync so the whole document (including portaled modals) flips.
  useEffect(() => {
    const root = document.documentElement;
    root.lang = locale;
    root.dir = dir;
  }, [locale, dir]);

  const t = useCallback<Translate>(
    (key, vars) => {
      const table = dictionaries[locale];
      const value = table[key] ?? English[key] ?? key;
      return interpolate(value, vars);
    },
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      dir,
      t,
      setLocale: (next) => onLocaleChange?.(next),
    }),
    [locale, dir, t, onLocaleChange],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error('useI18n must be used inside <I18nProvider>');
  return ctx;
}

/** Translation helper alone, for modules that do not need the locale. */
export function useT(): Translate {
  return useI18n().t;
}
