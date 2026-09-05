import React, { Fragment, useEffect, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';

import { SettingsDivider, SettingsGroup, SettingsRow } from '../../components/ui/SettingsGroup';
import { Banner } from '../../components/ui/Banner';
import { Sheet } from '../../components/ui/Sheet';
import { useAppContext } from '../../contexts/AppContext';
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
import { IconSize, Radius, Space } from '../../theme/tokens';
import type {
  SpeechRecognitionLanguage,
  ThemeMode,
} from '../../types';
import type { AccountSettingsAction } from './model';

export type AccountPreferenceAction = Extract<
  AccountSettingsAction,
  'theme' | 'accent' | 'speech-language' | 'app-icon'
>;

type PreferenceOption = Readonly<{
  id: string;
  label: string;
  selected: boolean;
  swatch?: string;
  onSelect: () => boolean | void | Promise<boolean | void>;
}>;

export function isAccountPreferenceAction(
  action: string,
): action is AccountPreferenceAction {
  return action === 'theme'
    || action === 'accent'
    || action === 'speech-language'
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
  const app = useAppContext();
  const [appIcon, setAppIcon] = useState<AppIconVariant>('default');
  const [appIconSupported, setAppIconSupported] = useState(false);
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
    if (preference === 'speech-language') {
      const values: ReadonlyArray<Readonly<{ id: SpeechRecognitionLanguage; label: string }>> = [
        { id: 'system', label: t('Follow System') },
        { id: 'en', label: t('English') },
        { id: 'zh-Hans', label: t('Simplified Chinese') },
        { id: 'ja', label: t('Japanese') },
        { id: 'ko', label: t('Korean') },
        { id: 'de', label: t('German') },
        { id: 'es', label: t('Spanish') },
      ];
      return values.map((option) => ({
        ...option,
        selected: option.id === app.speechRecognitionLanguage,
        onSelect: () => app.onSpeechRecognitionLanguageChange(option.id),
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
    accentId,
    app.onSpeechRecognitionLanguageChange,
    app.speechRecognitionLanguage,
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

  const title = preference === 'theme'
    ? t('Theme')
    : preference === 'accent'
      ? t('Accent Color')
      : preference === 'speech-language'
        ? t('Recognition Language')
        : t('App Icon');

  return (
    <Sheet
      testID="account-preference-sheet"
      visible
      title={title}
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      onClose={onClose}
    >
      <View style={styles.content}>
        {errorMessage ? (
          <Banner
            testID="account-preference-error"
            tone="bad"
            message={errorMessage}
          />
        ) : null}
        <SettingsGroup>
          {options.map((option, index) => (
            <Fragment key={option.id}>
              {index > 0 ? <SettingsDivider inset="content" /> : null}
              <SettingsRow
                testID={`account-preference-${option.id}`}
                title={option.label}
                disabled={preference === 'app-icon' && (!appIconSupported || pending)}
                onPress={() => {
                  void Promise.resolve(option.onSelect()).then((didSelect) => {
                    if (didSelect !== false) {
                      onChanged?.(preference, option.id);
                      onClose();
                    }
                  }).catch(() => undefined);
                }}
                leading={option.swatch ? (
                  <View style={[styles.swatch, { backgroundColor: option.swatch }]} />
                ) : undefined}
                trailing={option.selected ? (
                  <Check size={IconSize.sm} color={theme.colors.accent} />
                ) : undefined}
              />
            </Fragment>
          ))}
        </SettingsGroup>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.md,
  },
  swatch: {
    width: IconSize.md,
    height: IconSize.md,
    borderRadius: Radius.full,
  },
});
