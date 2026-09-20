import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { Banner } from '../../components/ui/Banner';
import { Sheet } from '../../components/ui/Sheet';
import {
  getCurrentAppIconAsync,
  isAppIconChangeSupportedAsync,
  setCurrentAppIconAsync,
  type AppIconVariant,
} from '../../services/app-icon';
import {
  builtInAccents,
  useAppTheme,
  type BuiltInAccentColorId,
} from '../../theme';
import { ControlSize, IconSize, Radius, Space } from '../../theme/tokens';
import type { ThemeMode } from '../../types';
import { useAppLanguage } from '../../i18n/AppLanguageProvider';
import { APP_LANGUAGES, APP_LANGUAGE_NAMES, type AppLanguage } from '../../i18n/language';
import type { AccountSettingsAction } from './model';

export type AccountPreferenceAction = Extract<
  AccountSettingsAction,
  'app-language' | 'theme' | 'accent' | 'app-icon'
>;

type PreferenceOption = Readonly<{
  id: string;
  label: string;
  selected: boolean;
  swatch?: string;
  onSelect: () => boolean | void | Promise<boolean | void>;
}>;

// The language list outgrows a phone screen, so it scrolls inside fixed snap
// points; the shorter preference lists keep the sheet's dynamic height.
const LANGUAGE_SHEET_SNAP_POINTS: string[] = ['62%', '92%'];

export function isAccountPreferenceAction(
  action: string,
): action is AccountPreferenceAction {
  return action === 'app-language'
    || action === 'theme'
    || action === 'accent'
    || action === 'app-icon';
}

export function AccountPreferenceSheet({
  preference,
  onClose,
  onChanged,
}: Readonly<{
  preference: AccountPreferenceAction;
  onClose: () => void;
  onChanged?: (preference: AccountPreferenceAction, value: string) => void;
}>): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme, mode, accentId, setMode, setAccentId } = useAppTheme();
  const { language, setLanguage } = useAppLanguage();
  const [appIcon, setAppIcon] = useState<AppIconVariant>('default');
  const [appIconSupported, setAppIconSupported] = useState(false);
  const selecting = useRef(false);
  const [pending, setPending] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    setErrorMessage(null);
    if (preference !== 'app-icon') return;
    let active = true;
    void Promise.all([
      isAppIconChangeSupportedAsync(),
      getCurrentAppIconAsync(),
    ]).then(([supported, icon]) => {
      if (!active) return;
      setAppIconSupported(supported);
      setAppIcon(icon);
    }).catch(() => {
      if (active) setAppIconSupported(false);
    });
    return () => {
      active = false;
    };
  }, [preference]);

  const options = useMemo<ReadonlyArray<PreferenceOption>>(() => {
    if (preference === 'app-language') {
      return (['system', ...APP_LANGUAGES] as AppLanguage[]).map((id) => ({
        id,
        label: id === 'system' ? t('Follow System') : APP_LANGUAGE_NAMES[id],
        selected: id === language,
        onSelect: async () => {
          setPending(true);
          setErrorMessage(null);
          try {
            await setLanguage(id);
            return true;
          } catch {
            setErrorMessage(t('Unable to change app language'));
            return false;
          } finally {
            setPending(false);
          }
        },
      }));
    }
    if (preference === 'theme') {
      const values: ReadonlyArray<Readonly<{ id: ThemeMode; label: string }>> = [
        { id: 'system', label: t('Follow System') },
        { id: 'light', label: t('Light') },
        { id: 'dark', label: t('Dark') },
      ];
      return values.map((option) => ({
        ...option,
        selected: option.id === mode,
        onSelect: () => setMode(option.id),
      }));
    }
    if (preference === 'accent') {
      const labels: Readonly<Record<BuiltInAccentColorId, string>> = {
        iceBlue: t('Blue'),
        jadeGreen: t('Green'),
        oceanTeal: t('Teal'),
        sunsetOrange: t('Orange'),
        rosePink: t('Pink'),
        royalPurple: t('Purple'),
      };
      return (Object.keys(labels) as BuiltInAccentColorId[]).map((id) => ({
        id,
        label: labels[id],
        selected: id === accentId,
        swatch: builtInAccents[id][theme.scheme].accent500,
        onSelect: () => setAccentId(id),
      }));
    }
    return ([
      { id: 'default' as const, label: t('Light') },
      { id: 'black' as const, label: t('Dark') },
    ]).map((option) => ({
      ...option,
      selected: option.id === appIcon,
      onSelect: async () => {
        if (!appIconSupported || pending) return false;
        setErrorMessage(null);
        setPending(true);
        try {
          await setCurrentAppIconAsync(option.id);
          setAppIcon(option.id);
          return true;
        } catch {
          setErrorMessage(t('Unable to change app icon'));
          return false;
        } finally {
          setPending(false);
        }
      },
    }));
  }, [
    language,
    setLanguage,
    accentId,
    appIcon,
    appIconSupported,
    mode,
    pending,
    preference,
    setAccentId,
    setMode,
    t,
    theme.scheme,
  ]);

  const title = preference === 'app-language'
    ? t('App language')
    : preference === 'theme'
    ? t('Theme')
    : preference === 'accent'
      ? t('Accent Color')
      : t('App Icon');

  const scrolls = preference === 'app-language';
  const Body = scrolls ? BottomSheetScrollView : View;
  return (
    <Sheet
      testID="account-preference-sheet"
      visible
      title={title}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      onClose={onClose}
      snapPoints={scrolls ? LANGUAGE_SHEET_SNAP_POINTS : undefined}
    >
      <Body
        style={scrolls ? styles.scroll : styles.content}
        contentContainerStyle={scrolls ? styles.content : undefined}
        showsVerticalScrollIndicator={false}
      >
        {errorMessage ? (
          <Banner
            testID="account-preference-error"
            tone="bad"
            message={errorMessage}
          />
        ) : null}
        <SettingsGroup density="comfortable">
          {options.map((option) => (
            <SettingsRow
              key={option.id}
              testID={`account-preference-${option.id}`}
              title={option.label}
              selected={option.selected}
              disabled={pending || (preference === 'app-icon' && !appIconSupported)}
              onPress={() => {
                if (selecting.current) return;
                selecting.current = true;
                void Promise.resolve().then(() => option.onSelect()).then((didSelect) => {
                  if (didSelect !== false) {
                    onChanged?.(preference, option.id);
                    onClose();
                  }
                }).catch(() => setErrorMessage(t('Please try again later.', { ns: 'common' })))
                  .finally(() => { selecting.current = false; });
              }}
              leading={preference === 'app-icon' ? <Image accessible={false} source={option.id === 'black'
                ? require('../../../assets/app-icons/black/app-icon-black-1024.png')
                : require('../../../assets/icon.png')} style={styles.appIcon} /> : option.swatch ? (
                <View style={[styles.swatch, { backgroundColor: option.swatch }]} />
              ) : undefined}
              trailing={(
                <View style={[styles.selection, option.selected ? { backgroundColor: theme.colors.ink } : null]}>
                  {option.selected ? <Check size={IconSize.sm} strokeWidth={2} color={theme.colors.canvas} /> : null}
                </View>
              )}
            />
          ))}
        </SettingsGroup>
      </Body>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1, minHeight: 0 },
  content: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.md,
  },
  selection: { width: Space.xl, height: Space.xl, borderRadius: Radius.full, alignItems: 'center', justifyContent: 'center' },
  appIcon: { width: ControlSize.pill, height: ControlSize.pill, borderRadius: Radius.settingsGroup },
  swatch: {
    width: IconSize.md,
    height: IconSize.md,
    borderRadius: Radius.full,
  },
});
