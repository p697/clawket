import React, { Fragment, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { Bell, Check, MoreHorizontal, Plus, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Banner } from '../../components/ui/Banner';
import { Button } from '../../components/ui/Button';
import { FloatingButton } from '../../components/ui/FloatingButton';
import { FormTextInput } from '../../components/ui/FormTextInput';
import { SearchInput } from '../../components/ui/SearchInput';
import { SegmentedTabs } from '../../components/ui/SegmentedTabs';
import {
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
} from '../../components/ui/SettingsGroup';
import { Sheet } from '../../components/ui/Sheet';
import { ThemedSwitch } from '../../components/ui/ThemedSwitch';
import {
  builtInAccents,
  type BuiltInAccentColorId,
  useAppTheme,
} from '../../theme';
import {
  ControlSize,
  FontSize,
  FontWeight,
  IconSize,
  LineHeight,
  Radius,
  Space,
} from '../../theme/tokens';
import type { ThemeMode } from '../../types';
import { AccountSettingsPageHeader } from './AccountSettingsPageHeader';

type GalleryTab = 'theme' | 'tokens' | 'components';
type CanonicalColorToken =
  | 'canvas'
  | 'canvasGrouped'
  | 'surface'
  | 'surfaceFloating'
  | 'ink'
  | 'inkSecondary'
  | 'inkTertiary'
  | 'line'
  | 'accent'
  | 'accentSoft'
  | 'good'
  | 'warn'
  | 'bad';

export type DesignSystemScreenProps = Readonly<{
  onBack: () => void;
}>;

function translateAccentLabel(
  id: BuiltInAccentColorId,
  t: ReturnType<typeof useTranslation>['t'],
): string {
  if (id === 'iceBlue') return t('Ice Blue');
  if (id === 'jadeGreen') return t('Jade Green');
  if (id === 'oceanTeal') return t('Ocean Teal');
  if (id === 'sunsetOrange') return t('Sunset Orange');
  if (id === 'rosePink') return t('Rose Pink');
  return t('Royal Purple');
}

const COLOR_TOKENS: ReadonlyArray<CanonicalColorToken> = [
  'canvas',
  'canvasGrouped',
  'surface',
  'surfaceFloating',
  'ink',
  'inkSecondary',
  'inkTertiary',
  'line',
  'accent',
  'accentSoft',
  'good',
  'warn',
  'bad',
];

export function DesignSystemScreen({
  onBack,
}: DesignSystemScreenProps): React.JSX.Element {
  const { t } = useTranslation(['config', 'common']);
  const { theme, mode, accentId, setMode, setAccentId } = useAppTheme();
  const insets = useSafeAreaInsets();
  const [galleryTab, setGalleryTab] = useState<GalleryTab>('theme');
  const [search, setSearch] = useState('');
  const [field, setField] = useState('Clawket');
  const [enabled, setEnabled] = useState(true);
  const [sheetVisible, setSheetVisible] = useState(false);

  const galleryTabs = useMemo(() => [
    { key: 'theme' as const, label: t('Theme') },
    { key: 'tokens' as const, label: t('common:Tokens') },
    { key: 'components' as const, label: t('common:Settings') },
  ], [t]);
  const themeTabs = useMemo<Array<{ key: ThemeMode; label: string }>>(() => [
    { key: 'system', label: t('System') },
    { key: 'light', label: t('Light') },
    { key: 'dark', label: t('Dark') },
  ], [t]);

  return (
    <View
      testID="design-system-screen"
      style={[styles.screen, { backgroundColor: theme.colors.canvasGrouped }]}
    >
      <AccountSettingsPageHeader
        testID="design-system"
        title={t('Design System')}
        onBack={onBack}
      />
      <ScrollView
        automaticallyAdjustContentInsets={false}
        contentContainerStyle={[
          styles.content,
          { paddingBottom: insets.bottom + Space.xl },
        ]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <SegmentedTabs
          testID="design-system-tabs"
          tabs={galleryTabs}
          active={galleryTab}
          onSwitch={setGalleryTab}
        />

        {galleryTab === 'theme' ? (
          <View style={styles.stack}>
            <SegmentedTabs
              testID="design-system-theme"
              tabs={themeTabs}
              active={mode}
              onSwitch={setMode}
              size="sm"
            />
            <SettingsGroup testID="design-system-accents">
              {(Object.keys(builtInAccents) as BuiltInAccentColorId[]).map((id, index) => {
                const selected = accentId === id;
                const swatch = builtInAccents[id][theme.scheme].accent500;
                return (
                  <Fragment key={id}>
                    {index > 0 ? <SettingsDivider inset="content" /> : null}
                    <SettingsRow
                      testID={`design-system-accent-${id}`}
                      title={translateAccentLabel(id, t)}
                      leading={(
                        <View
                          style={[styles.swatch, { backgroundColor: swatch }]}
                        />
                      )}
                      trailing={selected ? (
                        <Check
                          testID={`design-system-accent-${id}-selected`}
                          size={IconSize.sm}
                          color={theme.colors.accent}
                          strokeWidth={2}
                        />
                      ) : undefined}
                      onPress={() => setAccentId(id)}
                    />
                  </Fragment>
                );
              })}
            </SettingsGroup>
          </View>
        ) : galleryTab === 'tokens' ? (
          <View style={styles.stack}>
            <SettingsGroup testID="design-system-color-tokens">
              {COLOR_TOKENS.map((token, index) => (
                <Fragment key={token}>
                  {index > 0 ? <SettingsDivider inset="content" /> : null}
                  <SettingsRow
                    testID={`design-system-token-${token}`}
                    title={token}
                    trailing={(
                      <View
                        style={[
                          styles.swatch,
                          { backgroundColor: theme.colors[token] },
                        ]}
                      />
                    )}
                  />
                </Fragment>
              ))}
            </SettingsGroup>
            <SettingsGroup testID="design-system-type-tokens">
              <View style={styles.typeSamples}>
                <Text style={[styles.titleSample, { color: theme.colors.ink }]}>
                  title · 20/26
                </Text>
                <Text style={[styles.bodySample, { color: theme.colors.ink }]}>
                  body · 17/24
                </Text>
                <Text
                  style={[
                    styles.secondarySample,
                    { color: theme.colors.inkSecondary },
                  ]}
                >
                  secondary · 15/20
                </Text>
              </View>
            </SettingsGroup>
          </View>
        ) : (
          <View style={styles.stack}>
            <SearchInput
              testID="design-system-search"
              value={search}
              onChangeText={setSearch}
              placeholder={t('Search components')}
            />
            <FormTextInput
              testID="design-system-field"
              value={field}
              onChangeText={setField}
              placeholder={t('Raised field')}
            />
            <FormTextInput
              testID="design-system-invalid-field"
              value={t('Needs attention')}
              onChangeText={() => {}}
              surface="sunken"
              invalid
            />
            <SettingsGroup testID="design-system-settings-group">
              <SettingsRow
                title={t('Unified setting row')}
                trailing={(
                  <ThemedSwitch
                    testID="design-system-switch"
                    accessibilityLabel={t('Unified setting row')}
                    value={enabled}
                    onValueChange={setEnabled}
                  />
                )}
              />
              <SettingsDivider inset="content" />
              <SettingsRow
                testID="design-system-interactive-row"
                title={t('Interactive row')}
                showChevron
                onPress={() => setSheetVisible(true)}
              />
            </SettingsGroup>
            <Banner message={t('Needs attention')} />
            <Button label={t('Primary action')} icon={Plus} />
            <Button label={t('Secondary action')} variant="secondary" />
            <Button label={t('Ghost action')} variant="ghost" />
            <Button
              label={t('Destructive action')}
              variant="destructive"
              icon={Trash2}
            />
            <Button label={t('Disabled action')} disabled />
            <View style={styles.actionRow}>
              <FloatingButton
                icon={Bell}
                onPress={() => setSheetVisible(true)}
                accessibilityLabel={t('Notification')}
              />
              <FloatingButton
                icon={Plus}
                onPress={() => setSheetVisible(true)}
                accessibilityLabel={t('Add')}
                appearance="accent"
              />
              <FloatingButton
                icon={Trash2}
                onPress={() => setSheetVisible(true)}
                accessibilityLabel={t('Delete')}
                appearance="destructive"
              />
              <FloatingButton
                icon={MoreHorizontal}
                onPress={() => {}}
                accessibilityLabel={t('More, disabled')}
                disabled
              />
            </View>
            <Button
              testID="design-system-sheet-preview"
              label={t('Preview')}
              variant="secondary"
              onPress={() => setSheetVisible(true)}
            />
          </View>
        )}
      </ScrollView>

      <Sheet
        visible={sheetVisible}
        testID="design-system-sheet"
        title={t('Preview')}
        closeAccessibilityLabel={t('common:Close')}
        onClose={() => setSheetVisible(false)}
      >
        <View style={styles.sheetContent}>
          <SettingsGroup>
            <SettingsRow
              title={t('Selected')}
              trailing={(
                <Check
                  size={IconSize.sm}
                  color={theme.colors.accent}
                  strokeWidth={2}
                />
              )}
            />
          </SettingsGroup>
          <Button
            label={t('common:Done')}
            onPress={() => setSheetVisible(false)}
          />
        </View>
      </Sheet>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: {
    paddingHorizontal: Space.lg,
    gap: Space.lg,
  },
  stack: { gap: Space.md },
  swatch: {
    width: IconSize.md,
    height: IconSize.md,
    borderRadius: Radius.full,
  },
  typeSamples: {
    minHeight: ControlSize.settingsRow,
    padding: Space.lg,
    gap: Space.sm,
  },
  titleSample: {
    fontSize: FontSize.title,
    lineHeight: LineHeight.title,
    fontWeight: FontWeight.semibold,
  },
  bodySample: {
    fontSize: FontSize.body,
    lineHeight: LineHeight.body,
    fontWeight: FontWeight.regular,
  },
  secondarySample: {
    fontSize: FontSize.secondary,
    lineHeight: LineHeight.secondary,
    fontWeight: FontWeight.regular,
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sheetContent: {
    paddingHorizontal: Space.lg,
    paddingBottom: Space.xxl,
    gap: Space.lg,
  },
});
