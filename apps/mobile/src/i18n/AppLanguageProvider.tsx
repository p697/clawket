import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reloadAppAsync } from 'expo';
import i18n from 'i18next';
import { isRtlLocale, parseAppLanguage, resolveAppLocale, type AppLanguage } from './language';

const STORAGE_KEY = 'clawket.appLanguage.v1';
const LanguageContext = createContext({
  language: 'system' as AppLanguage,
  setLanguage: async (_language: AppLanguage): Promise<void> => {},
});

export const useAppLanguage = () => useContext(LanguageContext);

// Layout direction is process-wide native state, so a change between an RTL
// and an LTR locale is the one language switch that must reload the app.
export async function syncLayoutDirection(locale: string): Promise<boolean> {
  const rtl = isRtlLocale(locale);
  if (I18nManager.isRTL === rtl) return false;
  I18nManager.allowRTL(rtl);
  I18nManager.forceRTL(rtl);
  await reloadAppAsync('App layout direction changed');
  return true;
}

async function applyLanguage(language: AppLanguage): Promise<void> {
  const locale = resolveAppLocale(language);
  await i18n.changeLanguage(locale);
  await syncLayoutDirection(locale);
}

export function AppLanguageProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const [language, setLanguageState] = useState<AppLanguage>('system');
  const current = useRef<AppLanguage>('system');
  const revision = useRef(0);
  const saving = useRef(false);

  useEffect(() => {
    let active = true;
    const initialRevision = revision.current;
    void AsyncStorage.getItem(STORAGE_KEY).then(async (stored) => {
      if (!active || revision.current !== initialRevision) return;
      current.current = parseAppLanguage(stored);
      setLanguageState(current.current);
      await applyLanguage(current.current);
    }).catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && current.current === 'system') {
        void applyLanguage('system').catch(() => undefined);
      }
    });
    return () => { active = false; subscription.remove(); };
  }, []);

  const setLanguage = useCallback(async (next: AppLanguage) => {
    if (saving.current) throw new Error('Language preference is saving');
    saving.current = true;
    revision.current += 1;
    try {
      await AsyncStorage.setItem(STORAGE_KEY, next);
      current.current = next;
      await i18n.changeLanguage(resolveAppLocale(next));
      setLanguageState(next);
      await syncLayoutDirection(resolveAppLocale(next));
    } finally {
      saving.current = false;
    }
  }, []);

  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}
