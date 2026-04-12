import React, { useCallback, useEffect, useMemo, useState } from 'react';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { ChevronDown, ChevronRight, RefreshCw, SlidersHorizontal } from 'lucide-react-native';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import { useTabBarHeight } from '../../hooks/useTabBarHeight';
import { HeaderActionButton, ModalSheet } from '../../components/ui';
import { ModelPickerModal, resolveProviderModel } from '../../components/chat/ModelPickerModal';
import type { ModelInfo } from '../../components/chat/ModelPickerModal';
import { useNativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { useAppContext } from '../../contexts/AppContext';
import { analyticsEvents } from '../../services/analytics/events';
import { loadGatewayModelPickerOptions } from '../../services/gateway-models';
import { AppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';
import { useConfigScreenController } from '../ConfigScreen/hooks/useConfigScreenController';
import type { ConsoleStackParamList } from './ConsoleTab';

// ---- Duration helpers ----

type DurationUnit = 'm' | 'h' | 'd';

const DURATION_UNITS: { key: DurationUnit; label: string }[] = [
  { key: 'm', label: 'min' },
  { key: 'h', label: 'hr' },
  { key: 'd', label: 'day' },
];

const DURATION_REGEX = /^(\d+)\s*(ms|s|m|h|d)$/;

/** Parse a duration string like "30m" into { value, unit }. Falls back to minutes. */
function parseDuration(raw: string): { value: string; unit: DurationUnit } {
  const trimmed = raw.trim();
  if (!trimmed) return { value: '', unit: 'm' };
  const match = trimmed.match(DURATION_REGEX);
  if (match) {
    const num = match[1];
    const u = match[2];
    // Map seconds/milliseconds to minutes for the picker (not useful for heartbeat)
    if (u === 'm' || u === 'h' || u === 'd') return { value: num, unit: u };
    return { value: num, unit: 'm' };
  }
  // Pure number → default unit is minutes
  if (/^\d+$/.test(trimmed)) return { value: trimmed, unit: 'm' };
  return { value: '', unit: 'm' };
}

function buildDuration(value: string, unit: DurationUnit): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed === '0') return '';
  return `${trimmed}${unit}`;
}

// ---- Time helpers ----

type ActiveHoursPickerTarget = 'start' | 'end';

function parseTimeToDate(value: string): Date {
  const match = value.trim().match(/^([01]\d|2[0-3]):([0-5]\d)$/);
  const now = new Date();
  if (!match) return now;
  const date = new Date(now);
  date.setHours(Number(match[1]), Number(match[2]), 0, 0);
  return date;
}

function formatTimeFromDate(value: Date): string {
  const hh = String(value.getHours()).padStart(2, '0');
  const mm = String(value.getMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// ---- Session helpers ----

type SessionMode = 'main' | 'isolated';

function resolveSessionMode(raw: string): SessionMode {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed === 'main' || trimmed === 'global') return 'main';
  return 'isolated';
}

// ---- Screen ----

export function HeartbeatSettingsScreen(): React.JSX.Element {
  const { t } = useTranslation('console');
  const tabBarHeight = useTabBarHeight();
  const controller = useConfigScreenController();
  const { gateway, currentAgentId } = useAppContext();
  const navigation =
    useNavigation<NativeStackNavigationProp<ConsoleStackParamList, 'HeartbeatSettings'>>();
  const { theme } = controller;
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const hasActiveGateway = controller.configs.length > 0;

  const handleRefresh = useCallback(() => {
    void controller.loadGatewaySettings();
  }, [controller]);

  const headerRight = useMemo(
    () => (
      <HeaderActionButton icon={RefreshCw} onPress={handleRefresh} />
    ),
    [handleRefresh],
  );

  useNativeStackModalHeader({
    navigation,
    title: t('Heartbeat'),
    rightContent: headerRight,
    onClose: () => navigation.goBack(),
  });

  // ---- Interval state (local, synced to controller) ----
  const parsed = useMemo(() => parseDuration(controller.heartbeatEvery), [controller.heartbeatEvery]);
  const [intervalValue, setIntervalValue] = useState(parsed.value);
  const [intervalUnit, setIntervalUnit] = useState<DurationUnit>(parsed.unit);

  // Sync from controller when external data loads
  useEffect(() => {
    const p = parseDuration(controller.heartbeatEvery);
    setIntervalValue(p.value);
    setIntervalUnit(p.unit);
  }, [controller.heartbeatEvery]);

  const updateInterval = useCallback(
    (nextValue: string, nextUnit: DurationUnit) => {
      // Only allow digits
      const cleaned = nextValue.replace(/[^0-9]/g, '');
      setIntervalValue(cleaned);
      setIntervalUnit(nextUnit);
      controller.setHeartbeatEvery(buildDuration(cleaned, nextUnit));
    },
    [controller],
  );

  // ---- Session state ----
  const [sessionMode, setSessionMode] = useState<SessionMode>('main');

  useEffect(() => {
    setSessionMode(resolveSessionMode(controller.heartbeatSession));
  }, [controller.heartbeatSession]);

  const handleSessionModeChange = useCallback(
    (mode: SessionMode) => {
      setSessionMode(mode);
      if (mode === 'main') {
        controller.setHeartbeatSession('');
      } else {
        // Use the existing custom key, or default to "heartbeat"
        const existing = controller.heartbeatSession.trim().toLowerCase();
        if (!existing || existing === 'main' || existing === 'global') {
          controller.setHeartbeatSession('heartbeat');
        }
      }
    },
    [controller],
  );

  // ---- Model picker state ----
  const [modelPickerVisible, setModelPickerVisible] = useState(false);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);

  const openModelPicker = useCallback(() => {
    setModelPickerVisible(true);
    setModelsLoading(true);
    loadGatewayModelPickerOptions(gateway).then((result) => {
      setModels(result);
    }).catch(() => {
      setModels([]);
    }).finally(() => {
      setModelsLoading(false);
    });
  }, [gateway]);

  const selectModel = useCallback((selected: ModelInfo) => {
    const resolved = selected.id ? resolveProviderModel(selected) : '';
    controller.setHeartbeatModel(resolved);
    setModelPickerVisible(false);
  }, [controller]);

  // ---- Active hours picker state ----
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<ActiveHoursPickerTarget>('start');
  const [pickerDate, setPickerDate] = useState<Date>(new Date());

  const activeHoursSummary =
    controller.heartbeatActiveStart && controller.heartbeatActiveEnd
      ? `${controller.heartbeatActiveStart} - ${controller.heartbeatActiveEnd}`
      : t('Not set');

  const openPicker = useCallback(
    (target: ActiveHoursPickerTarget) => {
      setPickerTarget(target);
      const currentValue =
        target === 'start'
          ? controller.heartbeatActiveStart
          : controller.heartbeatActiveEnd;
      setPickerDate(parseTimeToDate(currentValue));
      setPickerVisible(true);
    },
    [controller.heartbeatActiveEnd, controller.heartbeatActiveStart],
  );

  const applyPicker = useCallback(() => {
    const next = formatTimeFromDate(pickerDate);
    if (pickerTarget === 'start') controller.setHeartbeatActiveStart(next);
    else controller.setHeartbeatActiveEnd(next);
    setPickerVisible(false);
  }, [pickerDate, pickerTarget, controller]);

  const clearPicker = useCallback(() => {
    if (pickerTarget === 'start') controller.setHeartbeatActiveStart('');
    else controller.setHeartbeatActiveEnd('');
    setPickerVisible(false);
  }, [pickerTarget, controller]);

  const fieldDisabled =
    !hasActiveGateway ||
    controller.loadingGatewaySettings ||
    controller.savingGatewaySettings;

  // ---- HEARTBEAT.md preview ----
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [filePreviewLoading, setFilePreviewLoading] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!hasActiveGateway) return;
      setFilePreviewLoading(true);
      gateway
        .getAgentFile('HEARTBEAT.md', currentAgentId)
        .then((result) => {
          setFilePreview(result.missing ? '' : (result.content ?? ''));
        })
        .catch(() => setFilePreview(null))
        .finally(() => setFilePreviewLoading(false));
    }, [hasActiveGateway, gateway, currentAgentId]),
  );

  // ---- Settings expand/collapse ----
  const [settingsExpanded, setSettingsExpanded] = useState(false);

  const settingsSummary = useMemo(() => {
    const parts: string[] = [];
    if (intervalValue) {
      const unitLabel = DURATION_UNITS.find((u) => u.key === intervalUnit)?.label ?? intervalUnit;
      parts.push(`${t('Every')} ${intervalValue} ${unitLabel}`);
    } else {
      parts.push(t('Off'));
    }
    if (controller.heartbeatActiveStart && controller.heartbeatActiveEnd) {
      parts.push(`${controller.heartbeatActiveStart}–${controller.heartbeatActiveEnd}`);
    } else {
      parts.push(t('All day'));
    }
    parts.push(sessionMode === 'main' ? t('Main') : t('Isolated'));
    parts.push(controller.heartbeatModel || t('Default'));
    return parts.join(' · ');
  }, [intervalValue, intervalUnit, controller.heartbeatActiveStart, controller.heartbeatActiveEnd, sessionMode, controller.heartbeatModel, t]);

  return (
    <View style={styles.root}>
      <ScrollView
        contentContainerStyle={[
          styles.container,
          {
            paddingTop: Space.lg,
            paddingBottom: Space.xxxl + tabBarHeight,
          },
        ]}
      >
        {/* Hero instruction card */}
        <View style={[styles.card, styles.instructionCard]}>
          <View style={styles.instructionHeader}>
            <Text style={styles.instructionEmoji}>💗</Text>
            <View style={styles.instructionHeaderText}>
              <Text style={styles.instructionTitle}>{t('What to do on each heartbeat')}</Text>
              <Text style={styles.instructionSubtitle}>
                {t('Tap to edit — write what the agent should do each time it runs.')}
              </Text>
            </View>
          </View>

          <Pressable
            onPress={() => navigation.navigate('FileEditor', { fileName: 'HEARTBEAT.md' })}
            style={({ pressed }) => [
              styles.instructionPreviewArea,
              pressed && styles.instructionPreviewAreaPressed,
            ]}
            disabled={fieldDisabled}
          >
            {filePreviewLoading ? (
              <ActivityIndicator size="small" color={theme.colors.textSubtle} />
            ) : filePreview ? (
              <Text style={styles.previewText} numberOfLines={5}>
                {filePreview}
              </Text>
            ) : (
              <Text style={styles.previewPlaceholder}>
                {t('No instructions set yet. Tap to add one.')}
              </Text>
            )}
          </Pressable>

          <View style={styles.instructionFooter}>
            <Pressable
              onPress={() => navigation.navigate('FileEditor', { fileName: 'HEARTBEAT.md' })}
              style={({ pressed }) => [
                styles.editButton,
                pressed && styles.editButtonPressed,
              ]}
              disabled={fieldDisabled}
            >
              <Text style={styles.editButtonText}>{t('common:Edit')}</Text>
              <ChevronRight size={14} color={theme.colors.primary} strokeWidth={2.5} />
            </Pressable>
          </View>
        </View>

        {/* Settings card — compact header with inline summary, expands on tap */}
        <View style={[styles.card, styles.settingsCard]}>
          <Pressable
            onPress={() => setSettingsExpanded(!settingsExpanded)}
            style={({ pressed }) => [styles.settingsHeader, pressed && styles.rowPressed]}
          >
            <View style={styles.settingsHeaderLeft}>
              <SlidersHorizontal size={15} color={theme.colors.textMuted} strokeWidth={2} />
              <Text style={styles.settingsTitle}>{t('Schedule')}</Text>
            </View>
            {!settingsExpanded && (
              <Text style={styles.settingsSummaryText} numberOfLines={1}>
                {settingsSummary}
              </Text>
            )}
            <ChevronDown
              size={16}
              color={theme.colors.textSubtle}
              strokeWidth={2}
              style={{ transform: [{ rotate: settingsExpanded ? '180deg' : '0deg' }] }}
            />
          </Pressable>

          {settingsExpanded && (
            <>
              <View style={styles.divider} />

              {/* Heartbeat Interval */}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('Interval')}</Text>
                <Text style={styles.rowMeta}>
                  {t('How often the agent sends a heartbeat (leave empty to disable)')}
                </Text>
                <View style={styles.intervalRow}>
                  <TextInput
                    keyboardType="number-pad"
                    returnKeyType="done"
                    autoCorrect={false}
                    placeholder="30"
                    placeholderTextColor={theme.colors.textSubtle}
                    style={styles.intervalInput}
                    value={intervalValue}
                    onChangeText={(text) => updateInterval(text, intervalUnit)}
                    editable={!fieldDisabled}
                    maxLength={4}
                    selectTextOnFocus
                  />
                  <View style={styles.unitSelector}>
                    {DURATION_UNITS.map((u) => {
                      const active = u.key === intervalUnit;
                      return (
                        <Pressable
                          key={u.key}
                          onPress={() => updateInterval(intervalValue, u.key)}
                          disabled={fieldDisabled}
                          style={[
                            styles.unitOption,
                            active && styles.unitOptionActive,
                          ]}
                        >
                          <Text
                            style={[
                              styles.unitOptionText,
                              active && styles.unitOptionTextActive,
                            ]}
                          >
                            {u.label}
                          </Text>
                        </Pressable>
                      );
                    })}
                  </View>
                </View>
              </View>

              <View style={styles.divider} />

              {/* Active Hours */}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('Active Hours')}</Text>
                <Text style={styles.rowMeta}>
                  {t('Run heartbeats only in this local window')}
                </Text>
                <Text style={styles.activeHoursSummary}>{activeHoursSummary}</Text>
                <View style={styles.activeHoursRow}>
                  <Pressable
                    onPress={() => openPicker('start')}
                    style={({ pressed }) => [
                      styles.rowPicker,
                      styles.activeHoursPicker,
                      pressed && styles.rowPressed,
                    ]}
                    disabled={fieldDisabled}
                  >
                    <Text
                      style={[
                        styles.rowPickerText,
                        !controller.heartbeatActiveStart && styles.placeholderText,
                      ]}
                      numberOfLines={1}
                    >
                      {controller.heartbeatActiveStart || t('Start (HH:MM)')}
                    </Text>
                    <ChevronRight
                      size={16}
                      color={theme.colors.textSubtle}
                      strokeWidth={2}
                    />
                  </Pressable>
                  <Pressable
                    onPress={() => openPicker('end')}
                    style={({ pressed }) => [
                      styles.rowPicker,
                      styles.activeHoursPicker,
                      pressed && styles.rowPressed,
                    ]}
                    disabled={fieldDisabled}
                  >
                    <Text
                      style={[
                        styles.rowPickerText,
                        !controller.heartbeatActiveEnd && styles.placeholderText,
                      ]}
                      numberOfLines={1}
                    >
                      {controller.heartbeatActiveEnd || t('End (HH:MM)')}
                    </Text>
                    <ChevronRight
                      size={16}
                      color={theme.colors.textSubtle}
                      strokeWidth={2}
                    />
                  </Pressable>
                </View>
              </View>

              <View style={styles.divider} />

              {/* Model Override */}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('Model Override')}</Text>
                <Text style={styles.rowMeta}>
                  {t('Use a specific model for heartbeat runs (optional)')}
                </Text>
                <Pressable
                  onPress={openModelPicker}
                  style={({ pressed }) => [
                    styles.rowPicker,
                    pressed && styles.rowPressed,
                  ]}
                  disabled={fieldDisabled}
                >
                  <Text
                    style={[
                      styles.rowPickerText,
                      !controller.heartbeatModel && styles.placeholderText,
                    ]}
                    numberOfLines={1}
                  >
                    {controller.heartbeatModel || t('Default')}
                  </Text>
                  <ChevronRight
                    size={16}
                    color={theme.colors.textSubtle}
                    strokeWidth={2}
                  />
                </Pressable>
              </View>

              <View style={styles.divider} />

              {/* Session */}
              <View style={styles.row}>
                <Text style={styles.rowLabel}>{t('Session')}</Text>
                <Text style={styles.rowMeta}>
                  {sessionMode === 'main'
                    ? t('Heartbeat shares your chat context — it can read and write to your conversation history.')
                    : t('Heartbeat runs independently in the background. It won\'t see or write to your chat, but can still use all tools.')}
                </Text>
                <View style={styles.sessionSelector}>
                  {(['main', 'isolated'] as const).map((mode) => {
                    const active = mode === sessionMode;
                    return (
                      <Pressable
                        key={mode}
                        onPress={() => handleSessionModeChange(mode)}
                        disabled={fieldDisabled}
                        style={[
                          styles.unitOption,
                          styles.sessionOption,
                          active && styles.unitOptionActive,
                        ]}
                      >
                        <Text
                          style={[
                            styles.unitOptionText,
                            active && styles.unitOptionTextActive,
                          ]}
                        >
                          {mode === 'main' ? t('Main') : t('Isolated')}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              </View>
            </>
          )}

          {controller.gatewaySettingsError ? (
            <>
              {settingsExpanded && <View style={styles.divider} />}
              <View style={styles.row}>
                <Text style={styles.errorText}>
                  {controller.gatewaySettingsError}
                </Text>
              </View>
            </>
          ) : null}
        </View>

        <Pressable
          onPress={() => {
            analyticsEvents.heartbeatSaveTapped({
              has_active_hours: Boolean(controller.heartbeatActiveStart.trim() || controller.heartbeatActiveEnd.trim()),
              has_model: Boolean(controller.heartbeatModel),
              session_mode: sessionMode,
            });
            void controller.saveGatewaySettings();
          }}
          style={({ pressed }) => [
            styles.primaryButton,
            pressed && styles.primaryButtonPressed,
            fieldDisabled && styles.buttonDisabled,
          ]}
          disabled={fieldDisabled}
        >
          <Text style={styles.primaryButtonText}>
            {controller.savingGatewaySettings ? t('common:Saving...') : t('common:Save')}
          </Text>
        </Pressable>
      </ScrollView>

      <ModalSheet
        visible={pickerVisible}
        onClose={() => setPickerVisible(false)}
        title={pickerTarget === 'start' ? t('Heartbeat Start Time') : t('Heartbeat End Time')}
        maxHeight="55%"
      >
        <View style={styles.timePickerBody}>
          <DateTimePicker
            value={pickerDate}
            mode="time"
            display="spinner"
            onChange={(_event, selectedDate) => {
              if (selectedDate) setPickerDate(selectedDate);
            }}
          />
          <View style={styles.timePickerActions}>
            <Pressable
              onPress={() => setPickerVisible(false)}
              style={({ pressed }) => [
                styles.outlineButton,
                styles.timePickerActionButton,
                pressed && styles.outlineButtonPressed,
              ]}
            >
              <Text style={styles.outlineButtonText}>{t('common:Cancel')}</Text>
            </Pressable>
            <Pressable
              onPress={clearPicker}
              style={({ pressed }) => [
                styles.destructiveButton,
                styles.timePickerActionButton,
                pressed && styles.destructiveButtonPressed,
              ]}
            >
              <Text style={styles.destructiveButtonText}>{t('common:Clear')}</Text>
            </Pressable>
            <Pressable
              onPress={applyPicker}
              style={({ pressed }) => [
                styles.primaryButton,
                styles.timePickerActionButton,
                pressed && styles.primaryButtonPressed,
              ]}
            >
              <Text style={styles.primaryButtonText}>{t('Set')}</Text>
            </Pressable>
          </View>
        </View>
      </ModalSheet>

      <ModelPickerModal
        visible={modelPickerVisible}
        onClose={() => setModelPickerVisible(false)}
        title={t('Model Override')}
        models={models}
        loading={modelsLoading}
        selectedModelId={controller.heartbeatModel || undefined}
        showDefault
        onSelectModel={selectModel}
      />

    </View>
  );
}

// ---- Styles ----

function createStyles(colors: AppTheme['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    container: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.lg,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      ...Shadow.sm,
    },
    divider: {
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.borderStrong,
      marginLeft: Space.lg,
    },
    row: {
      paddingHorizontal: Space.lg,
      paddingVertical: 13,
    },
    rowLabel: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    rowMeta: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      marginTop: 3,
    },
    // ---- Instruction hero card ----
    instructionCard: {
      marginBottom: Space.md,
    },
    instructionHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
      paddingHorizontal: Space.lg,
      paddingTop: Space.lg,
      paddingBottom: Space.sm,
    },
    instructionEmoji: {
      fontSize: 28,
    },
    instructionHeaderText: {
      flex: 1,
    },
    instructionTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    instructionSubtitle: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      marginTop: 3,
    },
    instructionPreviewArea: {
      marginHorizontal: Space.lg,
      marginBottom: Space.sm,
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.sm,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
      minHeight: 80,
      justifyContent: 'center',
    },
    instructionPreviewAreaPressed: {
      backgroundColor: colors.borderStrong,
    },
    previewText: {
      color: colors.text,
      fontSize: FontSize.sm,
      lineHeight: 19,
      fontFamily: 'monospace' as const,
    },
    previewPlaceholder: {
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      fontStyle: 'italic',
    },
    instructionFooter: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.md,
      alignItems: 'flex-end',
    },
    editButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      paddingVertical: Space.xs,
      paddingHorizontal: Space.sm,
    },
    editButtonPressed: {
      opacity: 0.6,
    },
    editButtonText: {
      color: colors.primary,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
    },
    // ---- Settings card ----
    settingsCard: {
      marginBottom: 0,
    },
    settingsHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingHorizontal: Space.lg,
      paddingVertical: 13,
    },
    settingsHeaderLeft: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    settingsTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
    },
    settingsSummaryText: {
      flex: 1,
      color: colors.textSubtle,
      fontSize: FontSize.sm,
      textAlign: 'right',
      marginRight: Space.xs,
    },
    // ---- Interval: number input + unit segmented selector ----
    intervalRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      marginTop: Space.sm,
    },
    intervalInput: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: 11,
      textAlign: 'center',
    },
    unitSelector: {
      flexDirection: 'row',
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
    },
    unitOption: {
      paddingHorizontal: Space.lg,
      paddingVertical: 11,
    },
    unitOptionActive: {
      backgroundColor: colors.primary,
    },
    unitOptionText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
    },
    unitOptionTextActive: {
      color: colors.primaryText,
    },
    // ---- Session selector ----
    sessionSelector: {
      flexDirection: 'row',
      borderRadius: Radius.md,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surfaceMuted,
      overflow: 'hidden',
      marginTop: Space.sm,
    },
    sessionOption: {
      flex: 1,
      alignItems: 'center',
    },
    // ---- Active hours ----
    activeHoursSummary: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      marginTop: Space.sm,
    },
    activeHoursRow: {
      marginTop: Space.sm,
      flexDirection: 'row',
      gap: Space.sm,
    },
    activeHoursPicker: {
      flex: 1,
      marginTop: 0,
    },
    rowPicker: {
      marginTop: Space.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      backgroundColor: colors.surfaceMuted,
      paddingHorizontal: Space.md,
      paddingVertical: 11,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: Space.sm,
    },
    rowPickerText: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
    },
    rowPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    placeholderText: {
      color: colors.textSubtle,
    },
    // ---- Error ----
    errorText: {
      color: colors.error,
      fontSize: FontSize.sm,
    },
    // ---- Action buttons ----
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: 11,
      marginTop: Space.lg,
      ...Shadow.md,
    },
    primaryButtonPressed: {
      opacity: 0.88,
    },
    primaryButtonText: {
      color: colors.primaryText,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    outlineButton: {
      alignItems: 'center',
      borderRadius: Radius.md,
      marginTop: Space.md,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: colors.primary,
      backgroundColor: colors.surface,
    },
    outlineButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    outlineButtonText: {
      color: colors.primary,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    destructiveButton: {
      alignItems: 'center',
      borderRadius: Radius.md,
      marginTop: Space.md,
      paddingVertical: 11,
      borderWidth: 1,
      borderColor: colors.error,
      backgroundColor: colors.surface,
    },
    destructiveButtonPressed: {
      backgroundColor: colors.surfaceMuted,
    },
    destructiveButtonText: {
      color: colors.error,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    buttonDisabled: {
      opacity: 0.55,
    },
    // ---- Time picker modal ----
    timePickerBody: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.lg,
      paddingTop: Space.sm,
      gap: Space.md,
    },
    timePickerActions: {
      flexDirection: 'row',
      gap: Space.sm,
    },
    timePickerActionButton: {
      flex: 1,
      marginTop: 0,
    },
  });
}
