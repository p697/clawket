import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { AppLanguageProvider, useAppLanguage } from './AppLanguageProvider';
import { parseAppLanguage, resolveAppLocale } from './language';

jest.mock('i18next', () => ({ __esModule: true, default: { changeLanguage: jest.fn().mockResolvedValue(undefined) } }));
let context: ReturnType<typeof useAppLanguage>;
function Consumer() { context = useAppLanguage(); return null; }
const mount = () => render(<AppLanguageProvider><Consumer /></AppLanguageProvider>);

describe('App language preferences', () => {
  beforeEach(() => { jest.clearAllMocks(); });

  it('restores the saved choice on remount and uses a separate storage key', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('ja');
    const view = mount();
    await waitFor(() => expect(context.language).toBe('ja'));
    await act(async () => { await context.setLanguage('de'); });
    expect(AsyncStorage.setItem).toHaveBeenCalledWith('clawket.appLanguage.v1', 'de');
    expect(i18n.changeLanguage).toHaveBeenLastCalledWith('de');
    view.unmount();
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('de');
    mount();
    await waitFor(() => expect(context.language).toBe('de'));
  });

  it('keeps the active choice when persistence fails', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('ja');
    mount();
    await waitFor(() => expect(context.language).toBe('ja'));
    jest.mocked(AsyncStorage.setItem).mockRejectedValueOnce(new Error('disk'));
    await act(async () => { await expect(context.setLanguage('es')).rejects.toThrow('disk'); });
    expect(context.language).toBe('ja');
    expect(i18n.changeLanguage).toHaveBeenLastCalledWith('ja');
  });

  it('refreshes system language on foreground but preserves explicit choices', async () => {
    const listener = jest.spyOn(AppState, 'addEventListener');
    jest.mocked(AsyncStorage.getItem).mockResolvedValue(null);
    mount();
    await waitFor(() => expect(i18n.changeLanguage).toHaveBeenCalled());
    jest.mocked(getLocales).mockReturnValue([{ languageCode: 'ko' }] as unknown as ReturnType<typeof getLocales>);
    await act(async () => { listener.mock.calls.at(-1)![1]('active'); });
    expect(i18n.changeLanguage).toHaveBeenLastCalledWith('ko');
    await act(async () => { await context.setLanguage('es'); });
    await act(async () => { listener.mock.calls.at(-1)![1]('active'); });
    expect(i18n.changeLanguage).toHaveBeenLastCalledWith('es');
    listener.mockRestore();
  });

  it('falls back for invalid settings and unsupported system locales', () => {
    expect(parseAppLanguage('bogus')).toBe('system');
    expect(parseAppLanguage(null)).toBe('system');
    jest.mocked(getLocales).mockReturnValue([{ languageCode: 'fr' }] as unknown as ReturnType<typeof getLocales>);
    expect(resolveAppLocale('system')).toBe('en');
    jest.mocked(getLocales).mockReturnValue([{ languageCode: 'zh' }] as unknown as ReturnType<typeof getLocales>);
    expect(resolveAppLocale('system')).toBe('zh-Hans');
  });
});
