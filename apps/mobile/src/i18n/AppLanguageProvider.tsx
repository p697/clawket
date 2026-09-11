import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import i18n from 'i18next';
import { parseAppLanguage, resolveAppLocale, type AppLanguage } from './language';

const STORAGE_KEY = 'clawket.appLanguage.v1';
const LanguageContext = createContext({
  language: 'system' as AppLanguage,
  setLanguage: async (_language: AppLanguage): Promise<void> => {},
});

export const useAppLanguage = () => useContext(LanguageContext);

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
      await i18n.changeLanguage(resolveAppLocale(current.current));
    }).catch(() => undefined);
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active' && current.current === 'system') {
        void i18n.changeLanguage(resolveAppLocale('system')).catch(() => undefined);
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
    } finally {
      saving.current = false;
    }
  }, []);

  return <LanguageContext.Provider value={{ language, setLanguage }}>{children}</LanguageContext.Provider>;
}
