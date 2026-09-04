import React, { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Bell, MoreHorizontal, Plus, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import {
  ActionButton,
  Button,
  Card,
  FormTextInput,
  SearchInput,
  SegmentedTabs,
  SettingsDivider,
  SettingsGroup,
  SettingsRow,
  ThemedSwitch,
  createCardContentStyle,
} from '../../components/ui';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { builtInAccents, type BuiltInAccentColorId, useAppTheme } from '../../theme';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';
import type { ThemeMode } from '../../types';
import type { ConfigStackParamList } from './ConfigTab';

type Navigation = NativeStackNavigationProp<ConfigStackParamList, 'DesignSystem'>;

const ACCENT_LABEL_KEYS: Record<BuiltInAccentColorId, string> = {
  iceBlue: 'Ice Blue',
  jadeGreen: 'Jade Green',
  oceanTeal: 'Ocean Teal',
  sunsetOrange: 'Sunset Orange',
  rosePink: 'Rose Pink',
  royalPurple: 'Royal Purple',
};

export function DesignSystemScreen(): React.JSX.Element {
  const navigation = useNavigation<Navigation>();
  const { t } = useTranslation('config');
  const { theme, mode, accentId, setMode, setAccentId } = useAppTheme();
  const [search, setSearch] = useState('');
  const [field, setField] = useState('Clawket');
  const [enabled, setEnabled] = useState(true);
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const themeTabs = useMemo<Array<{ key: ThemeMode; label: string }>>(() => [
    { key: 'system', label: t('System') },
    { key: 'light', label: t('Light') },
    { key: 'dark', label: t('Dark') },
  ], [t]);
  const close = useCallback(() => navigation.goBack(), [navigation]);

  useNativeStackModalHeader({ navigation, title: t('Design System'), onClose: close });

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={createCardContentStyle({ bottom: Space.xxxl })}
      keyboardShouldPersistTaps="handled"
    >
      <Text style={styles.intro}>
        {t('Live acceptance gallery for semantic colors, surfaces, controls, and states.')}
      </Text>

      <Text style={styles.sectionTitle}>{t('THEME')}</Text>
      <SegmentedTabs tabs={themeTabs} active={mode} onSwitch={setMode} containerStyle={styles.segmentedTabs} />
      <View style={styles.accentGrid}>
        {(Object.keys(builtInAccents) as BuiltInAccentColorId[]).map((id) => {
          const swatch = builtInAccents[id][theme.scheme].accent500;
          const selected = accentId === id;
          return (
            <Card
              key={id}
              onPress={() => setAccentId(id)}
              selected={selected}
              padding="sm"
              style={styles.accentCard}
            >
              <View style={[styles.accentSwatch, { backgroundColor: swatch }]} />
              <Text style={[styles.accentLabel, selected ? styles.accentLabelSelected : null]}>{t(ACCENT_LABEL_KEYS[id])}</Text>
            </Card>
          );
        })}
      </View>

      <Text style={styles.sectionTitle}>{t('SURFACES')}</Text>
      <View style={styles.stack}>
        {(['flat', 'raised', 'floating', 'overlay'] as const).map((elevation) => (
          <Card key={elevation} elevation={elevation} padding="lg">
            <Text style={styles.cardTitle}>{t(elevation[0].toUpperCase() + elevation.slice(1))}</Text>
            <Text style={styles.supportingText}>{t('One shared edge and lift recipe, adapted for {{mode}} mode.', {
              mode: t(theme.scheme === 'light' ? 'Light' : 'Dark'),
            })}</Text>
          </Card>
        ))}
        <View style={styles.cardRow}>
          <Card tone="muted" padding="md" style={styles.flexCard}>
            <Text style={styles.cardTitle}>{t('Muted')}</Text>
          </Card>
          <Card selected padding="md" style={styles.flexCard}>
            <Text style={styles.cardTitle}>{t('Selected')}</Text>
          </Card>
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('BUTTONS')}</Text>
      <View style={styles.stack}>
        <Button label={t('Primary action')} icon={Plus} />
        <Button label={t('Secondary action')} variant="secondary" />
        <Button label={t('Ghost action')} variant="ghost" />
        <Button label={t('Destructive action')} variant="destructive" icon={Trash2} />
        <Button label={t('Disabled action')} disabled />
        <View style={styles.actionRow}>
          <ActionButton icon={Bell} onPress={() => {}} accessibilityLabel={t('Notification')} appearance="bare" />
          <ActionButton icon={Bell} onPress={() => {}} accessibilityLabel={t('Notification on surface')} />
          <ActionButton icon={Plus} onPress={() => {}} accessibilityLabel={t('Add')} appearance="accent" />
          <ActionButton icon={Trash2} onPress={() => {}} accessibilityLabel={t('Delete')} appearance="destructive" />
          <ActionButton icon={MoreHorizontal} onPress={() => {}} accessibilityLabel={t('More, disabled')} disabled />
        </View>
      </View>

      <Text style={styles.sectionTitle}>{t('INPUTS')}</Text>
      <View style={styles.stack}>
        <SearchInput value={search} onChangeText={setSearch} placeholder={t('Search components')} />
        <FormTextInput value={field} onChangeText={setField} placeholder={t('Raised field')} />
        <FormTextInput value={t('Needs attention')} onChangeText={() => {}} surface="sunken" invalid />
        <FormTextInput
          value={t('Multiline fields keep the same chrome while owning only their content height.')}
          onChangeText={() => {}}
          multiline
          minHeight={96}
        />
      </View>

      <Text style={styles.sectionTitle}>{t('SETTINGS')}</Text>
      <SettingsGroup>
        <SettingsRow>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>{t('Unified setting row')}</Text>
            <Text style={styles.supportingText}>{t('Padding and pressed state come from the component.')}</Text>
          </View>
          <ThemedSwitch value={enabled} onValueChange={setEnabled} />
        </SettingsRow>
        <SettingsDivider inset="content" />
        <SettingsRow onPress={() => {}}>
          <View style={styles.rowCopy}>
            <Text style={styles.rowTitle}>{t('Interactive row')}</Text>
            <Text style={styles.supportingText}>{t('Uses the same divider and surface semantics.')}</Text>
          </View>
        </SettingsRow>
      </SettingsGroup>

      <Text style={styles.sectionTitle}>{t('TYPE')}</Text>
      <Card padding="lg">
        <Text style={styles.displayText}>Clawket</Text>
        <Text style={styles.cardTitle}>{t('Clear hierarchy, quiet chrome')}</Text>
        <Text style={styles.bodyText}>
          {t('Typography uses explicit size and line-height steps so screens do not invent local arithmetic.')}
        </Text>
        <Text style={styles.captionText}>{t('Supporting text · semantic muted color')}</Text>
      </Card>
    </ScrollView>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    intro: {
      color: colors.textMuted,
      fontSize: FontSize.base,
      lineHeight: LineHeight.base,
      marginBottom: Space.lg,
    },
    sectionTitle: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: LineHeight.sm,
      fontWeight: FontWeight.semibold,
      marginTop: Space.lg,
      marginBottom: Space.sm,
      letterSpacing: 0.5,
    },
    segmentedTabs: { marginHorizontal: 0, marginTop: 0, marginBottom: Space.md },
    accentGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
    accentCard: { width: '31%', alignItems: 'center', gap: Space.xs },
    accentSwatch: { width: 28, height: 28, borderRadius: Radius.full },
    accentLabel: { color: colors.textMuted, fontSize: FontSize.sm, lineHeight: LineHeight.sm },
    accentLabelSelected: { color: colors.primary, fontWeight: FontWeight.semibold },
    stack: { gap: Space.md },
    cardTitle: { color: colors.text, fontSize: FontSize.lg, lineHeight: LineHeight.lg, fontWeight: FontWeight.semibold },
    supportingText: { color: colors.textMuted, fontSize: FontSize.md, lineHeight: LineHeight.md },
    cardRow: { flexDirection: 'row', gap: Space.md },
    flexCard: { flex: 1 },
    actionRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rowCopy: { flex: 1, gap: Space.xs, paddingRight: Space.md },
    rowTitle: { color: colors.text, fontSize: FontSize.base, lineHeight: LineHeight.base, fontWeight: FontWeight.medium },
    displayText: { color: colors.primary, fontSize: FontSize.xxxl, lineHeight: LineHeight.xxxl, fontWeight: FontWeight.bold, marginBottom: Space.sm },
    bodyText: { color: colors.text, fontSize: FontSize.base, lineHeight: LineHeight.base, marginTop: Space.sm },
    captionText: { color: colors.textSubtle, fontSize: FontSize.sm, lineHeight: LineHeight.sm, marginTop: Space.md },
  });
}
