import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  BackHandler,
  type LayoutChangeEvent,
  Platform,
  Pressable,
  type SectionListData,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { BottomSheetScrollView, BottomSheetSectionList } from '@gorhom/bottom-sheet';
import type { BottomSheetScrollViewMethods } from '@gorhom/bottom-sheet';
import { Check, Eye, Folder, RefreshCw, Settings2, ShieldAlert, type LucideIcon } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Animated, {
  Easing,
  FadeIn,
  useAnimatedStyle,
  useReducedMotion,
  useSharedValue,
  withTiming,
  type EntryExitAnimationFunction,
} from 'react-native-reanimated';
import type { ModelSelectionState, SessionPermissionMode } from '@clawket/agent-protocol';
import { useAppTheme } from '../../theme';
import { ControlSize, createThemedShadowStyle, FontSize, FontWeight, IconSize, LineHeight, Motion, Radius, Shadow, Space } from '../../theme/tokens';
import { triggerLightImpact } from '../../services/haptics';
import { SearchInput } from '../ui/SearchInput';
import { SettingsDivider, SettingsGroup } from '../ui/SettingsGroup';
import { Sheet } from '../ui/Sheet';
import { SheetHeaderButton } from '../ui/SheetHeaderButton';
import { SheetHeaderSpinner } from '../ui/SheetHeaderSpinner';
import { ThemedSwitch } from '../ui/ThemedSwitch';
import { ChevronLeft, ChevronRight } from '../ui/DirectionalIcon';
import { ListSkeleton } from '../ui/ListSkeleton';
import { ModelIcon } from './ModelIcon';
import type { ModelInfo } from './ModelPickerModal';
import { buildModelSections, resolveProviderModel, type ModelProviderInfo, type ModelSection } from './model-picker-data';
import {
  PERMISSION_MODE_ORDER,
  estimateLabelWidth,
  featuredModels,
  isCurrentModel,
  modelRowKey,
  resolveThinkingLayout,
} from './model-sheet-data';

type Page = 'overview' | 'catalog';
type AppColors = ReturnType<typeof useAppTheme>['theme']['colors'];

export type ModelSheetProps = Readonly<{
  visible: boolean;
  /** Opened from a permission prompt: the first page scrolls to the permission choices. */
  focusPermissions?: boolean;
  /** `global` choices change every conversation (Hermes, the local model). */
  scope: 'session' | 'global';
  /**
   * `native`: the computer confirms every write (Codex). Nothing looks chosen
   * until it does, the asking control spins while `busy`, and writes serialize.
   * `optimistic`: the model check moves at once (OpenClaw, Hermes, Pi).
   */
  writes: 'native' | 'optimistic';
  loading: boolean;
  busy?: boolean;
  /** A run is in progress and the computer refuses settings until it ends. */
  running?: boolean;
  error: string | null;
  models: ModelInfo[];
  providers?: ModelProviderInfo[];
  currentModel?: string;
  currentProvider?: string;
  /** The Agent's configured default (`provider/model`), tagged in the list. */
  configuredDefaultModel?: string;
  /** Models chosen recently on this device (`provider/model`), newest first. */
  recentModels?: readonly string[];
  thinking?: Readonly<{ current: string | null; options: readonly string[]; onSelect: (level: string) => void }>;
  fastMode?: ModelSelectionState['fastMode'];
  onSelectFastMode?: (enabled: boolean) => void;
  /** The backend offers per-conversation permissions; `permissions` may still be unread. */
  permissionsSupported?: boolean;
  permissions?: ModelSelectionState['permissions'];
  onSelectPermissions?: (mode: SessionPermissionMode) => void;
  /** Read-only facts of the conversation: context left and its project. */
  contextRemainingPercent?: number | null;
  project?: Readonly<{ label: string; path: string }> | null;
  /** The conversation's accent: checks, the selected thumb's ring, links and switches. */
  accentColor?: string;
  onManage?: () => void;
  onStopRun?: () => void;
  onClose: () => void;
  onRetry: () => void;
  onSelectModel: (model: ModelInfo) => void;
}>;

const PAGE_SLIDE = Space.xl;
const SEGMENT_HEIGHT_INLINE = 32;
const SEGMENT_HEIGHT_BLOCK = 36;
const SEGMENT_INSET = 2;
const SEGMENT_MIN_WIDTH = 46;
/** A write the computer never answered stops spinning after this long. */
const OPTIMISTIC_PENDING_TIMEOUT_MS = 8_000;

/**
 * The conversation's model settings (A+ chat design, owner-approved round 2
 * 2026-10-01): grouped cards on the grouped canvas, one page for every choice
 * — models (the current one, recent ones, then "All N models"), thinking and
 * speed, permissions — and the context and project as a quiet footnote. The
 * full catalog is the only second page; its Back sits where Close was and the
 * Android Back key returns to the first page.
 */
export function ModelSheet(props: ModelSheetProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const colors = theme.colors;
  // The interface accent is ink; checks, links and switches here wear the conversation's color.
  const accent = props.accentColor ?? (theme.chatColors ?? theme.colors).accent;
  const styles = useMemo(() => createStyles(colors, theme.scheme), [colors, theme.scheme]);
  const { width: windowWidth, height: windowHeight, fontScale } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  // Sticky until the sheet has gone: a first page measured past the sheet's
  // limit takes the fixed detent, where it scrolls.
  const [overflowed, setOverflowed] = useState(false);
  // The sizing is chosen before the sheet opens where it can be, so the first
  // page does not jump between detents. Native settings (models, thinking,
  // speed, permissions) always outgrow a phone; the shorter pages size to
  // their content unless large text or a short screen could push them past
  // the sheet's limit.
  const tallOverview = props.writes === 'native' || overflowed || fontScale > 1.15 || windowHeight - insets.top - insets.bottom < SHORT_SCREEN_HEIGHT;
  const reduceMotion = useReducedMotion();
  const native = props.writes === 'native';
  const [page, setPage] = useState<Page>('overview');
  const [direction, setDirection] = useState<1 | -1>(1);
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<string | null>(null);
  const [pendingThinking, setPendingThinking] = useState<string | null>(null);
  const [cardWidth, setCardWidth] = useState(() => windowWidth - Space.lg * 2);
  // While open, a content-sized first page only grows: when the adaptive
  // caption or a notice leaves, the room stays at the bottom instead of the
  // control under the finger dropping with the sheet's top edge.
  const [overviewFloor, setOverviewFloor] = useState(0);
  const overviewHeights = useRef({ frame: 0, content: 0 });
  const overflowCheck = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (overflowCheck.current) clearTimeout(overflowCheck.current);
  }, []);
  const scrollRef = useRef<BottomSheetScrollViewMethods>(null);
  const focusedRef = useRef(false);
  // Model management opens only after the sheet has gone (two modal layers never animate at once).
  const manageAfterClose = useRef(false);

  const currentEntry = useMemo(
    () => props.models.find((model) => isCurrentModel(model, props.currentModel, props.currentProvider)) ?? null,
    [props.currentModel, props.currentProvider, props.models],
  );
  // The first page's rows stay put while it is open: a tap moves the check,
  // never the rows. They are chosen again when the sheet opens, the catalog
  // changes, or the current model is one they do not show.
  const recentRef = useRef(props.recentModels);
  recentRef.current = props.recentModels;
  const currentRef = useRef(currentEntry);
  currentRef.current = currentEntry;
  const modelsRef = useRef(props.models);
  modelsRef.current = props.models;
  const defaultRef = useRef(props.configuredDefaultModel);
  defaultRef.current = props.configuredDefaultModel;
  // A write reads the catalog back as a new array with the same rows; only a
  // different catalog chooses the rows again.
  const catalogSignature = useMemo(() => props.models.map(modelRowKey).join('\n'), [props.models]);
  const chooseFeatured = useCallback((first?: ModelInfo | null) => featuredModels({
    models: modelsRef.current,
    current: first ?? currentRef.current,
    recentRefs: recentRef.current,
    defaultRef: defaultRef.current,
  }), []);
  const [featured, setFeatured] = useState<ModelInfo[]>(() => chooseFeatured());

  useEffect(() => {
    if (!props.visible) return;
    setPage('overview');
    setQuery('');
    setPending(null);
    setPendingThinking(null);
    focusedRef.current = false;
  }, [props.visible]);
  useEffect(() => {
    if (props.visible) setFeatured(chooseFeatured());
  }, [catalogSignature, chooseFeatured, props.configuredDefaultModel, props.visible]);
  useEffect(() => {
    if (currentEntry && !featured.some((model) => modelRowKey(model) === modelRowKey(currentEntry))) {
      setFeatured(chooseFeatured(currentEntry));
    }
  }, [chooseFeatured, currentEntry, featured]);
  // Native writes show their spinner only while the computer is applying them.
  useEffect(() => { if (!props.busy) setPending(null); }, [props.busy]);
  // An optimistic thinking write settles when the value arrives, fails, or times out.
  useEffect(() => {
    if (pendingThinking === null) return undefined;
    if (props.thinking?.current === pendingThinking || props.error) {
      setPendingThinking(null);
      return undefined;
    }
    const timer = setTimeout(() => setPendingThinking(null), OPTIMISTIC_PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pendingThinking, props.error, props.thinking?.current]);

  // Android Back leaves the catalog for the first page before it closes the sheet.
  useEffect(() => {
    if (Platform.OS !== 'android' || !props.visible || page !== 'catalog') return undefined;
    const listener = BackHandler.addEventListener('hardwareBackPress', () => {
      setDirection(-1);
      setPage('overview');
      return true;
    });
    return () => listener.remove();
  }, [page, props.visible]);

  const writeLocked = props.busy === true || props.running === true;
  const readLocked = writeLocked || props.loading;
  const nativePending = native && props.busy ? pending : null;
  const waiting = native ? (props.busy && !nativePending ? 'apply' : props.loading ? 'load' : null) : null;
  const title = props.permissionsSupported || props.fastMode?.available ? t('Model settings') : t('Models');
  const scopeLabel = props.scope === 'global' ? t('Shared by all conversations') : t('Only for this conversation');

  const openCatalog = useCallback(() => {
    setDirection(1);
    setQuery('');
    setPage('catalog');
  }, []);
  const closeCatalog = useCallback(() => {
    setDirection(-1);
    setQuery('');
    setPage('overview');
  }, []);

  const selectModel = useCallback((model: ModelInfo, fromCatalog: boolean) => {
    if (native && writeLocked) return;
    triggerLightImpact();
    if (native) setPending(modelRowKey(model));
    if (fromCatalog) {
      setFeatured(chooseFeatured(model));
      closeCatalog();
    }
    props.onSelectModel(model);
  }, [chooseFeatured, closeCatalog, native, props, writeLocked]);

  const selectThinking = useCallback((level: string) => {
    const thinking = props.thinking;
    if (!thinking || (native && writeLocked) || level === thinking.current) return;
    triggerLightImpact();
    if (native) setPending(`thinking-${level}`);
    else setPendingThinking(level);
    thinking.onSelect(level);
  }, [native, props.thinking, writeLocked]);

  const headerRight = props.onManage ? (
    <SheetHeaderButton testID="model-sheet-manage" icon={Settings2} accessibilityLabel={t('Manage', { ns: 'common' })}
      onPress={() => { manageAfterClose.current = true; props.onClose(); }} />
  ) : waiting ? (
    <SheetHeaderSpinner testID="model-sheet-waiting" immediate={waiting === 'apply'}
      accessibilityLabel={waiting === 'apply' ? t('Applying settings…') : t('Loading...', { ns: 'common' })} />
  ) : undefined;

  const pageEntering = useMemo(() => {
    if (reduceMotion) return FadeIn.duration(Motion.duration.fast);
    const from = direction * PAGE_SLIDE;
    const enter: EntryExitAnimationFunction = () => {
      'worklet';
      return {
        initialValues: { opacity: 0, transform: [{ translateX: from }] },
        animations: {
          opacity: withTiming(1, { duration: Motion.duration.normal, easing: Easing.out(Easing.cubic) }),
          transform: [{ translateX: withTiming(0, { duration: Motion.duration.normal, easing: Easing.out(Easing.cubic) }) }],
        },
      };
    };
    return enter;
  }, [direction, reduceMotion]);

  const modelRow = (model: ModelInfo, fromCatalog: boolean) => {
    const key = modelRowKey(model);
    const checked = isCurrentModel(model, props.currentModel, props.currentProvider);
    const isDefault = Boolean(props.configuredDefaultModel)
      && resolveProviderModel(model).toLowerCase() === props.configuredDefaultModel!.trim().toLowerCase();
    return (
      <ChoiceRow
        key={key}
        testID={`model-sheet-${fromCatalog ? 'catalog' : 'model'}-${key}`}
        title={native && model.resolvedModel ? model.resolvedModel : model.name || model.id}
        leading={<ModelIcon {...model} />}
        tag={isDefault ? t('Default') : undefined}
        checked={checked}
        pending={nativePending === key}
        disabled={native && writeLocked}
        accent={accent}
        onPress={() => selectModel(model, fromCatalog)}
        styles={styles}
        colors={colors}
      />
    );
  };

  const firstRead = props.loading && props.models.length === 0;
  const featuredRows = featured.length ? featured : currentEntry ? [currentEntry] : [];
  const hiddenCount = props.models.length - featuredRows.length;
  const modelsCard = (
    <SettingsGroup testID="model-sheet-models">
      {firstRead ? (
        <ListSkeleton testID="model-sheet-model-loading" accessibilityLabel={t('Loading models...')} icon rows={3} trailing="none" style={styles.skeleton} />
      ) : featuredRows.length ? featuredRows.map((model, index) => (
        <React.Fragment key={modelRowKey(model)}>
          {index > 0 ? <SettingsDivider inset="icon" /> : null}
          {modelRow(model, false)}
        </React.Fragment>
      )) : (
        <Text style={[styles.emptyText, { color: colors.inkSecondary }]}>{t('No models available')}</Text>
      )}
      {!firstRead && hiddenCount > 0 ? (
        <>
          <SettingsDivider inset="icon" />
          <Pressable testID="model-sheet-all-models" accessibilityRole="button" onPress={openCatalog}
            accessibilityLabel={t('All {{count}} models', { count: props.models.length })}
            style={({ pressed }) => [styles.linkRow, pressed ? styles.rowPressed : null]}>
            <Text style={[styles.linkText, { color: accent }]} numberOfLines={1}>{t('All {{count}} models', { count: props.models.length })}</Text>
            <ChevronRight size={IconSize.sm} color={colors.inkTertiary} strokeWidth={2} />
          </Pressable>
        </>
      ) : null}
    </SettingsGroup>
  );

  // ── Thinking and speed ──
  const thinking = props.thinking?.options.length ? props.thinking : null;
  // Labels render with `maxFontSizeMultiplier={1.3}`, so they are measured at that scale too.
  const thinkingScale = Math.min(fontScale, 1.3);
  const thinkingLabels = thinking ? thinking.options.map((level) => t(`thinking_${level}`)) : [];
  const layout = thinking ? resolveThinkingLayout({
    labels: thinkingLabels,
    cardWidth,
    rowLabel: t('Thinking Level'),
    fontScale: thinkingScale,
  }) : null;
  const shownThinking = pendingThinking ?? thinking?.current ?? null;
  const thinkingPendingLevel = native
    ? (nativePending?.startsWith('thinking-') ? nativePending.slice('thinking-'.length) : null)
    : pendingThinking;
  const thinkingCaption = shownThinking === 'adaptive' ? t('Adaptive: the model decides how long to think.')
    : thinking && thinking.current == null && !thinkingPendingLevel ? t('Computer settings') : null;
  const thinkingControl = thinking && layout ? (
    layout.kind === 'chips' ? (
      <View testID="model-sheet-thinking" accessibilityRole="radiogroup" style={styles.chips}>
        {thinking.options.map((level, index) => {
          const selected = level === thinking.current;
          const busy = thinkingPendingLevel === level;
          return (
            <Pressable key={level} testID={`model-sheet-thinking-${level}`} accessibilityRole="radio"
              accessibilityState={{ checked: selected, selected, disabled: native && writeLocked, busy }}
              disabled={native && writeLocked} onPress={() => selectThinking(level)}
              style={({ pressed }) => [styles.chip, selected ? { backgroundColor: colors.ink } : null, pressed ? styles.pressed : null]}>
              {busy ? <ActivityIndicator testID={`model-sheet-thinking-${level}-pending`} size="small" color={colors.inkSecondary} /> : (
                <Text maxFontSizeMultiplier={1.3} style={[styles.chipText, { color: selected ? colors.canvas : colors.ink }]}>{thinkingLabels[index]}</Text>
              )}
            </Pressable>
          );
        })}
      </View>
    ) : (
      <Segments
        testID="model-sheet-thinking"
        options={thinking.options}
        labels={thinkingLabels}
        selected={thinking.current}
        pending={thinkingPendingLevel}
        disabled={native && writeLocked}
        height={layout.kind === 'inline' ? SEGMENT_HEIGHT_INLINE : SEGMENT_HEIGHT_BLOCK}
        fontSize={layout.fontSize}
        compact={layout.kind === 'inline'}
        onSelect={selectThinking}
        colors={colors}
        styles={styles}
      />
    )
  ) : null;
  const fast = props.fastMode?.available ? props.fastMode : null;
  const fastPending = nativePending === 'fast';
  const fastRow = fast ? (
    <View testID="model-sheet-fast" style={styles.switchRow}>
      <View style={styles.copy}>
        <Text style={[styles.rowTitle, { color: colors.ink }]}>{t('Fast mode')}</Text>
        <Text style={[styles.rowSubtitle, { color: colors.inkSecondary }]}>
          {fast.enabled === null ? t('Computer settings') : t('Faster replies may use more of your plan.')}
        </Text>
      </View>
      <View style={styles.switchSlot}>
        {fastPending ? <ActivityIndicator testID="model-sheet-fast-pending" size="small" color={colors.inkSecondary} /> : (
          <ThemedSwitch testID="model-sheet-fast-switch" value={fast.enabled === true} disabled={writeLocked}
            accessibilityLabel={t('Fast mode')}
            // The conversation accent, like the sheet's checks; ThemedSwitch keeps the thumb and Android's visible off track.
            trackColor={{ false: Platform.OS === 'android' && theme.scheme === 'light' ? colors.inkTertiary : colors.line, true: accent }}
            onValueChange={(enabled) => {
              if (writeLocked) return;
              setPending('fast');
              props.onSelectFastMode?.(enabled);
            }} />
        )}
      </View>
    </View>
  ) : null;
  const inlineThinking = layout?.kind === 'inline';
  const thinkingRow = thinking ? (inlineThinking ? (
    <View style={styles.inlineThinkingRow}>
      <View style={styles.copy}>
        <Text style={[styles.rowTitle, { color: colors.ink }]} numberOfLines={1}>{t('Thinking Level')}</Text>
        {thinkingCaption ? <Text testID="model-sheet-thinking-caption" style={[styles.rowSubtitle, { color: colors.inkSecondary }]}>{thinkingCaption}</Text> : null}
      </View>
      {thinkingControl}
    </View>
  ) : (
    <View style={styles.blockThinking}>
      {thinkingControl}
      {thinkingCaption ? <Text testID="model-sheet-thinking-caption" style={[styles.blockCaption, { color: colors.inkSecondary }]}>{thinkingCaption}</Text> : null}
    </View>
  )) : null;
  const tuneCards = (
    <>
      {thinkingRow && !inlineThinking ? <SectionHeader title={t('Thinking Level')} styles={styles} colors={colors} /> : null}
      {thinkingRow || fastRow ? (
        <SettingsGroup testID="model-sheet-tuning" style={!thinkingRow || inlineThinking ? styles.cardGap : null}>
          {thinkingRow}
          {thinkingRow && fastRow && inlineThinking ? <SettingsDivider inset="content" /> : null}
          {inlineThinking || !thinkingRow ? fastRow : null}
        </SettingsGroup>
      ) : null}
      {thinkingRow && !inlineThinking && fastRow ? <SettingsGroup style={styles.cardGap}>{fastRow}</SettingsGroup> : null}
    </>
  );

  // ── Permissions ──
  const permissions = props.permissions;
  const requiresPermissions = permissions?.requiresConfirmation === true;
  const permissionUnknown = permissions?.mode == null;
  // Before the first answer arrives an unknown mode is not a result yet: no "Unknown", no Retry.
  const permissionPending = props.loading && permissionUnknown;
  // The last finished read decides the notice, so a refresh neither hides it nor inserts it again.
  const settledUnavailable = useRef(false);
  if (!props.loading) settledUnavailable.current = permissions?.available === false;
  const permissionLabels: Record<SessionPermissionMode, string> = {
    'read-only': t('Read only'), workspace: t('Workspace access'), 'full-access': t('Full access'),
  };
  const permissionDetails: Record<SessionPermissionMode, string> = {
    'read-only': t('Read files. Ask before making changes.'),
    workspace: t('Work in the project. Ask before broader access.'),
    'full-access': t('Run commands and change files without asking.'),
  };
  const permissionIcons: Record<SessionPermissionMode, LucideIcon> = { 'read-only': Eye, workspace: Folder, 'full-access': ShieldAlert };
  const modes = PERMISSION_MODE_ORDER.filter((mode) => !permissions?.availableModes || permissions.availableModes.includes(mode));
  const permissionStatus = permissionPending ? null
    : permissionUnknown ? (
      <View testID="model-sheet-permission-status" style={styles.headerStatus}>
        <Text style={[styles.headerStatusText, { color: colors.inkSecondary }]}>{t('Unknown', { ns: 'common' })}</Text>
        {!props.error ? (
          <Pressable testID="model-sheet-permissions-retry" accessibilityRole="button" accessibilityLabel={t('Retry', { ns: 'common' })}
            accessibilityState={{ disabled: readLocked }} disabled={readLocked} onPress={props.onRetry} hitSlop={HEADER_ACTION_HIT_SLOP}
            style={({ pressed }) => [styles.headerAction, readLocked ? styles.disabled : null, pressed ? styles.pressed : null]}>
            <RefreshCw size={IconSize.sm - 2} color={accent} strokeWidth={2} />
            <Text style={[styles.headerStatusText, { color: accent }]}>{t('Retry', { ns: 'common' })}</Text>
          </Pressable>
        ) : null}
      </View>
    ) : permissions?.mode === 'custom' ? (
      <Text testID="model-sheet-permission-status" style={[styles.headerStatusText, { color: colors.inkSecondary }]}>{t('Computer settings')}</Text>
    ) : null;
  const permissionsSection = props.permissionsSupported ? (
    <View testID="model-sheet-permissions" onLayout={(event: LayoutChangeEvent) => {
      if (!props.focusPermissions || focusedRef.current || page !== 'overview') return;
      focusedRef.current = true;
      const y = event.nativeEvent.layout.y;
      // After this layout pass, so the scroll view knows its content height.
      setTimeout(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - Space.lg), animated: !reduceMotion }), 0);
    }}>
      <SectionHeader title={t('Permissions', { ns: 'common' })} right={permissionStatus} styles={styles} colors={colors} />
      <SettingsGroup>
        {modes.map((mode, index) => {
          const Icon = permissionIcons[mode];
          const warn = mode === 'full-access';
          const key = `permission-${mode}`;
          const checked = !requiresPermissions && permissions?.mode === mode;
          return (
            <React.Fragment key={mode}>
              {index > 0 ? <SettingsDivider inset="icon" /> : null}
              <ChoiceRow
                testID={`model-sheet-${key}`}
                title={permissionLabels[mode]}
                subtitle={permissionDetails[mode]}
                titleColor={warn && checked ? colors.warn : undefined}
                leading={<Icon size={IconSize.md} color={warn ? colors.warn : colors.inkSecondary} strokeWidth={1.9} />}
                checked={checked}
                checkColor={warn ? colors.warn : accent}
                pending={nativePending === key}
                disabled={writeLocked || permissions?.available !== true}
                accent={accent}
                onPress={() => {
                  if (writeLocked || permissions?.available !== true) return;
                  if (permissions.availableModes && !permissions.availableModes.includes(mode)) return;
                  triggerLightImpact();
                  setPending(key);
                  props.onSelectPermissions?.(mode);
                }}
                styles={styles}
                colors={colors}
              />
            </React.Fragment>
          );
        })}
      </SettingsGroup>
      {requiresPermissions ? <Text testID="model-sheet-permission-required" accessibilityRole="alert" style={[styles.footnote, { color: colors.warn }]}>{t('Choose permissions again before sending.')}</Text> : null}
      {settledUnavailable.current ? <Text testID="model-sheet-permission-unavailable" style={[styles.footnote, { color: colors.inkSecondary }]}>{t('Permission changes are unavailable for this conversation. Check Codex on your computer.')}</Text> : null}
      {permissions?.unencryptedTransport ? <Text testID="model-sheet-permission-unencrypted" style={[styles.footnote, { color: colors.inkSecondary }]}>{t('This connection is not encrypted. Use a trusted network or switch to Relay.')}</Text> : null}
    </View>
  ) : null;

  const facts = props.contextRemainingPercent != null || props.project ? (
    <View style={styles.facts}>
      {props.contextRemainingPercent != null ? (
        <Text testID="model-sheet-context" accessible accessibilityLabel={t('Context remaining: {{percent}}%', { percent: props.contextRemainingPercent })}
          style={[styles.factText, { color: colors.inkSecondary }]}>{t('Context remaining: {{percent}}%', { percent: props.contextRemainingPercent })}</Text>
      ) : null}
      {props.project ? (
        <Text testID="model-sheet-project" accessible accessibilityLabel={`${t('Project')}: ${props.project.path}`} numberOfLines={1} ellipsizeMode="middle"
          style={[styles.factText, { color: colors.inkSecondary }]}>{`${t('Project')}  ${props.project.label}`}</Text>
      ) : null}
    </View>
  ) : null;

  const measureCards = (event: LayoutChangeEvent) => setCardWidth(Math.max(0, event.nativeEvent.layout.width - Space.lg * 2));
  // A content-sized page may shrink inside the sheet's limit; content taller
  // than its frame has outgrown the sheet. Layout events arrive child or
  // parent first, so the comparison waits for the whole batch.
  const scheduleOverflowCheck = () => {
    if (overflowCheck.current) clearTimeout(overflowCheck.current);
    overflowCheck.current = setTimeout(() => {
      overflowCheck.current = null;
      const { frame, content } = overviewHeights.current;
      if (frame > 0 && content + Space.lg > frame + 1) setOverflowed(true);
    }, 0);
  };
  const measureOverview = (event: LayoutChangeEvent) => {
    measureCards(event);
    const { height } = event.nativeEvent.layout;
    overviewHeights.current.frame = height;
    setOverviewFloor((floor) => Math.max(floor, height));
    scheduleOverflowCheck();
  };
  const measureOverviewContent = (event: LayoutChangeEvent) => {
    overviewHeights.current.content = event.nativeEvent.layout.height;
    scheduleOverflowCheck();
  };
  // The content slides back in from the catalog; the scroll view itself stays the body's direct child.
  const overviewContent = (
    <Animated.View testID="model-sheet-overview-content" entering={direction < 0 ? pageEntering : undefined}
      onLayout={tallOverview ? undefined : measureOverviewContent}>
      {props.running ? (
        <View testID="model-sheet-running" style={[styles.notice, { backgroundColor: colors.surfaceFloating }]}>
          <View style={[styles.noticeDot, { backgroundColor: accent }]} />
          <Text style={[styles.noticeText, { color: colors.ink }]}>{t('This turn is still running. Settings can change when it ends.')}</Text>
          {props.onStopRun ? (
            <Pressable testID="model-sheet-stop" accessibilityRole="button" onPress={props.onStopRun} hitSlop={Space.sm}
              style={({ pressed }) => [styles.noticeAction, pressed ? styles.pressed : null]}>
              <Text style={[styles.noticeActionText, { color: accent }]}>{t('Stop')}</Text>
            </Pressable>
          ) : null}
        </View>
      ) : null}
      {props.error ? (
        <View testID="model-sheet-error" style={[styles.notice, { backgroundColor: colors.surfaceFloating }]}>
          <Text accessibilityRole="alert" style={[styles.noticeText, { color: colors.bad }]}>{props.error}</Text>
          <Pressable testID="model-sheet-error-retry" accessibilityRole="button" accessibilityState={{ disabled: readLocked }}
            disabled={readLocked} onPress={props.onRetry} hitSlop={Space.sm}
            style={({ pressed }) => [styles.noticeAction, readLocked ? styles.disabled : null, pressed ? styles.pressed : null]}>
            <Text style={[styles.noticeActionText, { color: accent }]}>{t('Retry', { ns: 'common' })}</Text>
          </Pressable>
        </View>
      ) : null}
      <View style={props.running ? styles.locked : null}>
        <SectionHeader title={t('Models')} styles={styles} colors={colors} first={!props.running && !props.error} />
        {modelsCard}
        {tuneCards}
      </View>
      <View style={props.running ? styles.locked : null}>{permissionsSection}</View>
      {facts}
    </Animated.View>
  );
  // A content-sized sheet measures a plain body: Gorhom sizes a dynamic sheet from a scrollable's
  // content alone, which left the header's height of rows under the screen edge (device check 2026-10-01).
  const overview = tallOverview ? (
    <BottomSheetScrollView ref={scrollRef} testID="model-sheet-overview" style={styles.fill}
      contentContainerStyle={styles.scrollContent} onLayout={measureCards}>
      {overviewContent}
    </BottomSheetScrollView>
  ) : (
    <View testID="model-sheet-overview" style={[styles.scrollContent, styles.shrink, { minHeight: overviewFloor }]}
      onLayout={measureOverview}>
      {overviewContent}
    </View>
  );

  const catalogSections = useMemo(() => {
    const sections = buildModelSections(props.models, query, props.providers);
    const pinned = !query.trim() && currentEntry;
    const withoutCurrent = pinned
      ? sections.map((section) => ({ ...section, data: section.data.filter((model) => modelRowKey(model) !== modelRowKey(currentEntry)) }))
        .filter((section) => section.data.length > 0)
      : sections.filter((section) => section.data.length > 0);
    const providerTitles = withoutCurrent.length > 1;
    const list: (ModelSection & { key: string; showTitle: boolean })[] = withoutCurrent.map((section) => ({
      ...section, key: section.provider, showTitle: providerTitles,
    }));
    if (pinned) list.unshift({ title: t('Current'), provider: '', data: [currentEntry], totalModels: 1, key: 'current', showTitle: true });
    return list;
  }, [currentEntry, props.models, props.providers, query, t]);

  const catalog = (
    <View style={styles.catalog}>
      <SearchInput inSheet testID="model-sheet-search" value={query} onChangeText={setQuery} onClear={() => setQuery('')}
        placeholder={t('Search models...')} style={[styles.search, { backgroundColor: colors.surfaceFloating }]} />
      {firstRead ? (
        <ListSkeleton testID="model-sheet-catalog-loading" accessibilityLabel={t('Loading models...')} icon rows={6} trailing="none" style={styles.catalogSkeleton} />
      ) : (
        <BottomSheetSectionList<ModelInfo, ModelSection & { key: string; showTitle: boolean }>
          testID="model-sheet-catalog"
          sections={catalogSections}
          keyExtractor={(model) => modelRowKey(model)}
          stickySectionHeadersEnabled={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          // Filtering replaces whole sections while the keyboard resizes the
          // sheet; let React own the mounted rows (see ModelPickerModal).
          removeClippedSubviews={false}
          initialNumToRender={16}
          maxToRenderPerBatch={16}
          windowSize={7}
          contentContainerStyle={styles.catalogContent}
          renderSectionHeader={({ section }: { section: SectionListData<ModelInfo, ModelSection & { key: string; showTitle: boolean }> }) => (
            section.showTitle ? <SectionHeader title={section.title} styles={styles} colors={colors} /> : <View style={styles.cardGap} />
          )}
          renderItem={({ item, index, section }) => {
            const first = index === 0;
            const last = index === section.data.length - 1;
            return (
              <View style={[styles.catalogCell, { backgroundColor: colors.surfaceFloating }, first ? styles.cellFirst : null, last ? styles.cellLast : null]}>
                {first ? null : <SettingsDivider inset="icon" />}
                {modelRow(item, true)}
              </View>
            );
          }}
          ListEmptyComponent={<Text style={[styles.emptyText, { color: colors.inkSecondary }]}>{t('No models found')}</Text>}
        />
      )}
    </View>
  );

  const backLabel = title;
  const headerLeading = page === 'catalog' ? (
    <Pressable testID="model-sheet-back" accessibilityRole="button" accessibilityLabel={t('Back', { ns: 'common' })}
      onPress={closeCatalog} hitSlop={Space.xs} style={({ pressed }) => [styles.back, pressed ? styles.pressed : null]}>
      <ChevronLeft size={IconSize.lg} color={colors.ink} strokeWidth={2} />
      <Text style={[styles.backText, { color: colors.ink }]} numberOfLines={1}>{backLabel}</Text>
    </Pressable>
  ) : undefined;

  return (
    <Sheet
      testID="model-sheet"
      visible={props.visible}
      onClose={props.onClose}
      onAfterClose={() => {
        setOverviewFloor(0);
        setOverflowed(false);
        if (!manageAfterClose.current) return;
        manageAfterClose.current = false;
        props.onManage?.();
      }}
      tone="grouped"
      closeAccessibilityLabel={t('Close', { ns: 'common' })}
      headerLeading={headerLeading}
      titleContent={page === 'overview' ? (
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: colors.ink }]} numberOfLines={1}>{title}</Text>
          <Text testID="model-sheet-scope" style={[styles.scope, { color: colors.inkTertiary }]} numberOfLines={1}>{scopeLabel}</Text>
        </View>
      ) : (
        <Text style={[styles.title, { color: colors.ink }]} numberOfLines={1}>{t('All models')}</Text>
      )}
      headerRight={page === 'overview' ? headerRight : waiting ? (
        <SheetHeaderSpinner testID="model-sheet-waiting" immediate={waiting === 'apply'}
          accessibilityLabel={waiting === 'apply' ? t('Applying settings…') : t('Loading...', { ns: 'common' })} />
      ) : undefined}
      snapPoints={page === 'catalog' ? CATALOG_SNAP_POINTS : tallOverview ? TALL_OVERVIEW_SNAP_POINTS : undefined}
      contentStyle={page === 'overview' && !tallOverview ? styles.shrink : undefined}
      keyboardBehavior="extend"
      keyboardBlurBehavior="none"
      androidKeyboardInputMode="adjustResize"
    >
      {page === 'overview' ? overview : (
        <Animated.View key={page} entering={pageEntering} style={styles.fill}>
          {catalog}
        </Animated.View>
      )}
    </Sheet>
  );
}

const CATALOG_SNAP_POINTS = ['92%'];
const TALL_OVERVIEW_SNAP_POINTS = ['90%'];
/** Safe height under which even a short first page could outgrow the sheet. */
const SHORT_SCREEN_HEIGHT = 680;
const HEADER_ACTION_HIT_SLOP = { top: 13, bottom: 13, left: Space.sm, right: Space.sm };

function SectionHeader({ title, right, first = false, styles, colors }: Readonly<{
  title: string; right?: React.ReactNode; first?: boolean; styles: ReturnType<typeof createStyles>; colors: AppColors;
}>): React.JSX.Element {
  return (
    <View style={[styles.sectionHeader, first ? styles.sectionHeaderFirst : null]}>
      <Text accessibilityRole="header" style={[styles.sectionTitle, { color: colors.inkSecondary }]} numberOfLines={1}>{title}</Text>
      {right ?? null}
    </View>
  );
}

function ChoiceRow({ title, subtitle, titleColor, leading, tag, checked, checkColor, pending, disabled, accent, onPress, styles, colors, testID }: Readonly<{
  title: string;
  subtitle?: string;
  titleColor?: string;
  leading?: React.ReactNode;
  tag?: string;
  checked: boolean;
  checkColor?: string;
  pending: boolean;
  disabled: boolean;
  accent: string;
  onPress: () => void;
  styles: ReturnType<typeof createStyles>;
  colors: AppColors;
  testID: string;
}>): React.JSX.Element {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityLabel={[title, tag, subtitle].filter(Boolean).join(', ')}
      accessibilityState={{ checked, selected: checked, disabled, busy: pending }} disabled={disabled} onPress={onPress}
      style={({ pressed }) => [styles.choiceRow, subtitle ? styles.choiceRowTall : null, pressed && !disabled ? styles.rowPressed : null]}>
      {leading ? <View style={styles.leading}>{leading}</View> : null}
      <View style={styles.copy}>
        <Text style={[styles.rowTitle, { color: titleColor ?? colors.ink }]} numberOfLines={1}>{title}</Text>
        {subtitle ? <Text style={[styles.rowSubtitle, { color: colors.inkSecondary }]} numberOfLines={2}>{subtitle}</Text> : null}
      </View>
      {tag ? <Text testID={`${testID}-default`} style={[styles.tag, { color: colors.inkTertiary }]}>{tag}</Text> : null}
      <View style={styles.markSlot}>
        {pending ? <ActivityIndicator testID={`${testID}-pending`} size="small" color={colors.inkSecondary} />
          : checked ? <Check testID={`${testID}-selected`} size={IconSize.md} color={checkColor ?? accent} strokeWidth={2.6} /> : null}
      </View>
    </Pressable>
  );
}

/**
 * A segmented choice whose thumb slides to the confirmed value. A tapped
 * segment that is not confirmed yet spins in place of its label; no thumb
 * shows while the value is unknown.
 */
function Segments({ testID, options, labels, selected, pending, disabled, height, fontSize, compact, onSelect, colors, styles }: Readonly<{
  testID: string;
  options: readonly string[];
  labels: readonly string[];
  selected: string | null;
  pending: string | null;
  disabled: boolean;
  height: number;
  fontSize: number;
  compact: boolean;
  onSelect: (value: string) => void;
  colors: AppColors;
  styles: ReturnType<typeof createStyles>;
}>): React.JSX.Element {
  const reduceMotion = useReducedMotion();
  const [width, setWidth] = useState(0);
  const segmentWidth = width > 0 ? (width - SEGMENT_INSET * 2) / options.length : 0;
  const index = selected === null ? -1 : options.indexOf(selected);
  const offset = useSharedValue(index * segmentWidth);
  const visible = useSharedValue(index >= 0 ? 1 : 0);
  useEffect(() => {
    const target = Math.max(0, index) * segmentWidth;
    offset.value = reduceMotion || segmentWidth === 0 ? target
      : withTiming(target, { duration: Motion.duration.normal, easing: Easing.out(Easing.cubic) });
    visible.value = index >= 0 ? 1 : 0;
  }, [index, offset, reduceMotion, segmentWidth, visible]);
  const thumbStyle = useAnimatedStyle(() => ({ opacity: visible.value, transform: [{ translateX: offset.value }] }));
  const trackWidth = compact ? options.length * Math.max(SEGMENT_MIN_WIDTH, Math.ceil(Math.max(...labels.map((label) => estimateLabelWidth(label, fontSize))) + 12)) + SEGMENT_INSET * 2 : undefined;
  return (
    <View testID={testID} accessibilityRole="radiogroup"
      onLayout={(event: LayoutChangeEvent) => setWidth(event.nativeEvent.layout.width)}
      style={[styles.track, { height, borderRadius: height / 2, backgroundColor: colors.surface }, trackWidth ? { width: trackWidth } : styles.trackFull]}>
      {segmentWidth > 0 ? (
        <Animated.View pointerEvents="none" style={[styles.thumb, {
          width: segmentWidth, height: height - SEGMENT_INSET * 2, borderRadius: (height - SEGMENT_INSET * 2) / 2,
          backgroundColor: colors.surfaceFloating,
        }, thumbStyle]} />
      ) : null}
      {options.map((value, optionIndex) => {
        const checked = value === selected;
        const busy = pending === value;
        return (
          <Pressable key={value} testID={`${testID}-${value}`} accessibilityRole="radio" accessibilityLabel={labels[optionIndex]}
            accessibilityState={{ checked, selected: checked, disabled, busy }} disabled={disabled}
            onPress={() => onSelect(value)} style={({ pressed }) => [styles.segment, pressed && !disabled ? styles.pressed : null]}>
            {busy ? <ActivityIndicator testID={`${testID}-${value}-pending`} size="small" color={colors.inkSecondary} /> : (
              <Text maxFontSizeMultiplier={1.3} numberOfLines={1}
                style={{ fontSize, lineHeight: Math.round(fontSize * 1.3), fontWeight: checked ? FontWeight.semibold : FontWeight.regular, color: checked ? colors.ink : colors.inkSecondary }}>
                {labels[optionIndex]}
              </Text>
            )}
          </Pressable>
        );
      })}
    </View>
  );
}

function createStyles(colors: AppColors, scheme: 'light' | 'dark') {
  return StyleSheet.create({
    fill: { flex: 1, minHeight: 0 },
    shrink: { flexShrink: 1, minHeight: 0 },
    scrollContent: { paddingHorizontal: Space.lg, paddingBottom: Space.lg },
    titleBlock: { alignItems: 'center', minWidth: 0 },
    title: { fontSize: FontSize.body, lineHeight: LineHeight.title - 4, fontWeight: FontWeight.semibold, textAlign: 'center' },
    scope: { fontSize: FontSize.caption, lineHeight: LineHeight.caption, textAlign: 'center' },
    sectionHeader: {
      marginTop: Space.xl - 2,
      marginBottom: Space.sm - 1,
      paddingHorizontal: Space.lg,
      minHeight: LineHeight.caption,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    sectionHeaderFirst: { marginTop: Space.xs },
    sectionTitle: { flex: 1, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    headerStatus: { flexDirection: 'row', alignItems: 'center', gap: Space.md },
    headerStatusText: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    headerAction: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
    cardGap: { marginTop: Space.xl },
    choiceRow: {
      minHeight: ControlSize.settingsRow,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    choiceRowTall: { minHeight: ControlSize.settingsRow + Space.sm, paddingVertical: Space.sm + 2 },
    rowPressed: { backgroundColor: colors.surface },
    leading: { width: IconSize.lg, alignItems: 'center', justifyContent: 'center' },
    copy: { flex: 1, minWidth: 0, gap: 2 },
    rowTitle: { fontSize: FontSize.body, lineHeight: LineHeight.body - 2, fontWeight: FontWeight.regular },
    rowSubtitle: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    tag: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    markSlot: { width: IconSize.md + 2, alignItems: 'flex-end', justifyContent: 'center' },
    linkRow: {
      minHeight: ControlSize.floatingButton + Space.xs,
      paddingStart: ControlSize.settingsRow,
      paddingEnd: Space.lg,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    linkText: { flex: 1, fontSize: FontSize.body, lineHeight: LineHeight.body - 2 },
    inlineThinkingRow: {
      minHeight: ControlSize.settingsRow,
      paddingStart: Space.lg,
      paddingEnd: Space.md - 2,
      paddingVertical: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    blockThinking: { padding: Space.md, gap: Space.sm + 2 },
    blockCaption: { paddingHorizontal: Space.xs, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    switchRow: {
      minHeight: ControlSize.settingsRowComfortable,
      paddingHorizontal: Space.lg,
      paddingVertical: Space.sm + 2,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.md,
    },
    switchSlot: { minWidth: 51, minHeight: 31, alignItems: 'flex-end', justifyContent: 'center' },
    track: { flexDirection: 'row', alignItems: 'center', padding: SEGMENT_INSET, flexShrink: 0 },
    trackFull: { alignSelf: 'stretch' },
    thumb: {
      position: 'absolute',
      top: SEGMENT_INSET,
      start: SEGMENT_INSET,
      ...createThemedShadowStyle(colors, scheme, Shadow.xs),
    },
    segment: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 2 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: Space.sm },
    chip: {
      minHeight: ControlSize.pill - 4,
      paddingHorizontal: Space.md + 2,
      borderRadius: Radius.full,
      backgroundColor: colors.surface,
      alignItems: 'center',
      justifyContent: 'center',
    },
    chipText: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
    footnote: { marginTop: Space.sm, paddingHorizontal: Space.lg, fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    facts: { marginTop: Space.md, paddingHorizontal: Space.lg, gap: 2 },
    factText: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
    notice: {
      marginTop: Space.xs,
      marginBottom: Space.sm,
      minHeight: ControlSize.settingsRow,
      borderRadius: Radius.settingsGroup,
      paddingStart: Space.lg,
      paddingEnd: Space.sm,
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm + 2,
    },
    noticeDot: { width: Space.sm, height: Space.sm, borderRadius: Radius.full },
    noticeText: { flex: 1, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, paddingVertical: Space.sm },
    noticeAction: { minHeight: ControlSize.floatingButton, paddingHorizontal: Space.sm, justifyContent: 'center' },
    noticeActionText: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.semibold },
    locked: { opacity: 0.55 },
    disabled: { opacity: 0.45 },
    pressed: { opacity: Motion.pressedOpacity },
    skeleton: { paddingHorizontal: Space.lg, paddingVertical: Space.xs },
    emptyText: { padding: Space.lg, fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, textAlign: 'center' },
    back: { minHeight: ControlSize.floatingButton, marginStart: -Space.sm, flexDirection: 'row', alignItems: 'center', gap: 2, maxWidth: '100%' },
    backText: { flexShrink: 1, fontSize: FontSize.body, lineHeight: LineHeight.body - 2 },
    catalog: { flex: 1, minHeight: 0 },
    search: { marginHorizontal: Space.lg, marginTop: Space.xs },
    catalogSkeleton: { marginTop: Space.md, marginHorizontal: Space.lg },
    catalogContent: { paddingHorizontal: Space.lg, paddingBottom: Space.xl },
    catalogCell: { overflow: 'hidden' },
    cellFirst: { borderTopLeftRadius: Radius.settingsGroup, borderTopRightRadius: Radius.settingsGroup },
    cellLast: { borderBottomLeftRadius: Radius.settingsGroup, borderBottomRightRadius: Radius.settingsGroup },
  });
}
