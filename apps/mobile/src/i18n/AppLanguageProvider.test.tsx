import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { AppState, I18nManager } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reloadAppAsync } from 'expo';
import { getLocales } from 'expo-localization';
import i18n from 'i18next';
import { AppLanguageProvider, useAppLanguage } from './AppLanguageProvider';
import { parseAppLanguage, resolveAppLocale } from './language';

jest.mock('i18next', () => ({ __esModule: true, default: { changeLanguage: jest.fn().mockResolvedValue(undefined) } }));
let context: ReturnType<typeof useAppLanguage>;
function Consumer() { context = useAppLanguage(); return null; }
const mount = () => render(<AppLanguageProvider><Consumer /></AppLanguageProvider>);

describe('App language preferences', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    I18nManager.isRTL = false;
    jest.mocked(getLocales).mockReturnValue([{ languageCode: 'en' }] as unknown as ReturnType<typeof getLocales>);
  });

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
    jest.mocked(getLocales).mockReturnValue([{ languageCode: 'sw' }] as unknown as ReturnType<typeof getLocales>);
    expect(resolveAppLocale('system')).toBe('en');
    jest.mocked(getLocales).mockReturnValue([{ languageCode: 'zh' }] as unknown as ReturnType<typeof getLocales>);
    expect(resolveAppLocale('system')).toBe('zh-Hans');
  });

  it('reloads only when the layout direction changes', async () => {
    I18nManager.isRTL = false;
    jest.mocked(AppState.addEventListener).mockReturnValue({ remove: jest.fn() } as never);
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('de');
    mount();
    await waitFor(() => expect(context.language).toBe('de'));
    expect(reloadAppAsync).not.toHaveBeenCalled();
    await act(async () => { await context.setLanguage('fr'); });
    expect(I18nManager.allowRTL).toHaveBeenLastCalledWith(false);
    expect(I18nManager.forceRTL).toHaveBeenLastCalledWith(false);
    expect(reloadAppAsync).not.toHaveBeenCalled();
    await act(async () => { await context.setLanguage('ar'); });
    expect(I18nManager.allowRTL).toHaveBeenCalledWith(true);
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(true);
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
    I18nManager.isRTL = true;
    await act(async () => { await context.setLanguage('system'); });
    expect(I18nManager.forceRTL).toHaveBeenLastCalledWith(false);
    expect(reloadAppAsync).toHaveBeenCalledTimes(2);
    I18nManager.isRTL = false;
  });

  it('restores Arabic across a native reload without requesting another reload', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('ar');
    const first = mount();
    await waitFor(() => expect(reloadAppAsync).toHaveBeenCalledTimes(1));
    expect(I18nManager.forceRTL).toHaveBeenLastCalledWith(true);
    first.unmount();
    // A new RN runtime reads the direction persisted by the previous runtime.
    I18nManager.isRTL = true;
    mount();
    await waitFor(() => expect(i18n.changeLanguage).toHaveBeenCalledTimes(2));
    expect(context.language).toBe('ar');
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
  });

  it('pins an explicit LTR choice even when device direction currently matches', async () => {
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('en');
    mount();
    await waitFor(() => expect(I18nManager.allowRTL).toHaveBeenCalledWith(false));
    expect(I18nManager.forceRTL).toHaveBeenCalledWith(false);
    expect(reloadAppAsync).not.toHaveBeenCalled();
    await act(async () => { await context.setLanguage('zh-Hans'); });
    expect(reloadAppAsync).not.toHaveBeenCalled();
  });

  it('leaves Arabic for Chinese once, then restores LTR on the next native runtime', async () => {
    I18nManager.isRTL = true;
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('ar');
    const first = mount();
    await waitFor(() => expect(context.language).toBe('ar'));
    expect(reloadAppAsync).not.toHaveBeenCalled();
    await act(async () => { await context.setLanguage('zh-Hans'); });
    expect(AsyncStorage.setItem).toHaveBeenLastCalledWith('clawket.appLanguage.v1', 'zh-Hans');
    expect(I18nManager.allowRTL).toHaveBeenLastCalledWith(false);
    expect(I18nManager.forceRTL).toHaveBeenLastCalledWith(false);
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
    first.unmount();
    I18nManager.isRTL = false;
    jest.mocked(AsyncStorage.getItem).mockResolvedValue('zh-Hans');
    mount();
    await waitFor(() => expect(context.language).toBe('zh-Hans'));
    expect(reloadAppAsync).toHaveBeenCalledTimes(1);
  });

});
