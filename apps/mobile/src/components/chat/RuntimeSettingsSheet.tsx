import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { BottomSheetFlatList, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check, ChevronLeft, ChevronRight, RefreshCw, Shield, ShieldAlert, ShieldQuestionMark } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { ModelSelectionState, SessionPermissionMode, ThinkingLevel } from '@clawket/agent-protocol';
import type { ModelInfo } from '../../chat/useChatModelPicker';
import { useAppTheme } from '../../theme';
import { BorderWidth, ControlSize, FontSize, FontWeight, HitSize, LineHeight, Radius, Space } from '../../theme/tokens';
import { Button, SearchInput, Sheet, SheetHeaderSpinner } from '../ui';
import { ListSkeleton } from '../ui/ListSkeleton';

type Page = 'overview' | 'models' | 'thinking' | 'speed' | 'permissions';
export type RuntimeSettingsSheetProps = {
  visible: boolean;
  permissionsOnly?: boolean;
  loading: boolean;
  busy: boolean;
  running?: boolean;
  error: string | null;
  models: ModelInfo[];
  currentModel?: string;
  currentProvider?: string;
  thinkingLevel?: string | null;
  thinkingLevels: ThinkingLevel[];
  fastMode?: ModelSelectionState['fastMode'];
  permissions?: ModelSelectionState['permissions'];
  /** Read-only facts of the conversation (A+ composer): context left and its project. */
  contextRemainingPercent?: number | null;
  project?: Readonly<{ label: string; path: string }> | null;
  onClose: () => void;
  onRetry: () => void;
  onSelectModel: (model: ModelInfo) => void;
  onSelectThinking: (level: string) => void;
  onSelectFastMode: (enabled: boolean) => void;
  onSelectPermissions: (mode: SessionPermissionMode) => void;
};

/**
 * One quiet settings surface; only acknowledged native values get a checkmark. Waiting never inserts a
 * line (owner report 2026-09-29: the sheet jumped when its "Loading…" line went away): a refresh spins in
 * the header's free corner while the rows stay usable, and a write spins in the radio of the row that asked.
 */
export function RuntimeSettingsSheet(props: RuntimeSettingsSheetProps): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { theme } = useAppTheme();
  const colors = theme.colors;
  const { fontScale, height } = useWindowDimensions();
  const requiresPermissions = props.permissions?.requiresConfirmation === true;
  const scrollPermissions = pageForScroll(props.permissionsOnly || requiresPermissions, fontScale, height);
  const [page, setPage] = useState<Page>('overview');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<{ page: Page; key: string } | null>(null);
  useEffect(() => { if (props.visible) { setPage(props.permissionsOnly || requiresPermissions ? 'permissions' : 'overview'); setQuery(''); setPending(null); } }, [props.visible, props.permissionsOnly, requiresPermissions]);
  useEffect(() => { if (!props.busy) setPending(null); }, [props.busy]);
  const selected = props.models.find(model => (model.id === props.currentModel || model.resolvedModel === props.currentModel)
    && (!props.currentProvider || model.provider === props.currentProvider));
  const modelName = selected?.resolvedModel || selected?.name || props.currentModel || t('Computer settings');
  const permissionLabels = { workspace: t('Workspace access'), 'read-only': t('Read only'), 'full-access': t('Full access') };
  const permissionUnknown = props.permissions?.mode == null;
  const permissionLabel = permissionUnknown ? t('Unknown', { ns: 'common' })
    : props.permissions?.mode && props.permissions.mode !== 'custom'
      ? permissionLabels[props.permissions.mode] : t('Computer settings');
  // Writes are serialized; a read in flight is not a lock, because the hook fences it against newer writes.
  const writeLocked = props.busy || props.running === true;
  const readLocked = writeLocked || props.loading;
  // The last finished read decides the notice, so a refresh neither hides it nor inserts it again.
  const settledUnavailable = useRef(false);
  if (!props.loading) settledUnavailable.current = props.permissions?.available === false;
  // Before the first answer arrives an unknown mode is not a result yet: no "Unknown", no Retry.
  const permissionPending = props.loading && permissionUnknown;
  const pendingKey = props.busy && pending?.page === page ? pending.key : null;
  const waiting = props.busy && !pendingKey ? 'apply' : props.loading ? 'load' : null;
  const row = (key: string, label: string, onPress: () => void, options?: { value?: string; checked?: boolean; detail?: string; disabled?: boolean; warning?: boolean }) => {
    const choice = options?.checked !== undefined;
    const rowDisabled = (choice ? writeLocked : props.running === true) || options?.disabled === true;
    return (
      <Pressable key={key} testID={`runtime-settings-${key}`} accessibilityRole={choice ? 'radio' : 'button'}
        accessibilityState={{ checked: options?.checked, selected: options?.checked, disabled: rowDisabled, busy: pendingKey === key }}
        disabled={rowDisabled} onPress={() => { if (choice) setPending({ page, key }); onPress(); }}
        style={({ pressed }) => [styles.row, { backgroundColor: pressed ? colors.surface : 'transparent', opacity: props.running || options?.disabled ? 0.55 : 1 }]}>
        <View style={styles.rowText}><Text style={[styles.label, { color: options?.warning ? colors.warn : colors.ink }]}>{label}</Text>
          {options?.detail ? <Text style={[styles.detail, { color: colors.inkSecondary }]}>{options.detail}</Text> : null}</View>
        {options?.value ? <Text numberOfLines={1} style={[styles.value, { color: colors.inkSecondary }]}>{options.value}</Text> : null}
        {!choice ? <ChevronRight size={16} color={colors.inkTertiary} />
          : pendingKey === key ? <View testID={`runtime-settings-${key}-pending`} style={styles.radioSlot}><ActivityIndicator size="small" color={colors.inkSecondary} /></View>
            : <View style={[styles.radioSlot, styles.radio, { borderColor: options.checked ? colors.accent : colors.line, backgroundColor: options.checked ? colors.accent : 'transparent' }]}>
              {options.checked ? <Check size={14} color={colors.onAccent} strokeWidth={2.5} /> : null}
            </View>}
      </Pressable>
    );
  };
  // Facts, not settings: no chevron, no press.
  const fact = (key: string, label: string, value?: string, accessibilityLabel?: string) => (
    <View key={key} testID={`runtime-settings-${key}`} accessible accessibilityLabel={accessibilityLabel ?? (value ? `${label}: ${value}` : label)} style={styles.row}>
      <View style={styles.rowText}><Text style={[styles.label, { color: colors.ink }]}>{label}</Text></View>
      {value ? <Text numberOfLines={1} ellipsizeMode="middle" style={[styles.value, styles.factValue, { color: colors.inkSecondary }]}>{value}</Text> : null}
    </View>
  );
  const filteredModels = useMemo(() => { const search = query.trim().toLocaleLowerCase();
    return search ? props.models.filter(model => [model.id, model.name, model.resolvedModel, model.provider].some(value => value?.toLocaleLowerCase().includes(search))) : props.models;
  }, [props.models, query]);
  const PermissionBody = scrollPermissions ? BottomSheetScrollView : View;
  const titles = { overview: t('Model settings'), models: t('Models'), thinking: t('Thinking Level'), speed: t('Speed'), permissions: t('Permissions', { ns: 'common' }) };
  return <Sheet visible={props.visible} onClose={props.onClose} closeAccessibilityLabel={t('Close', { ns: 'common' })}
    title={titles[page]} testID="runtime-settings-sheet" snapPoints={page === 'models' || (page === 'permissions' && scrollPermissions) ? ['68%', '92%'] : undefined}
    headerRight={waiting ? <SheetHeaderSpinner testID="runtime-settings-waiting" immediate={waiting === 'apply'}
      accessibilityLabel={waiting === 'apply' ? t('Applying settings…') : t('Loading...', { ns: 'common' })} /> : undefined}
    titleContent={page !== 'overview' && !props.permissionsOnly ? <View style={styles.heading}>
      <Pressable accessibilityRole="button" accessibilityLabel={t('Back', { ns: 'common' })} onPress={() => setPage('overview')} style={styles.back}>
        <ChevronLeft size={20} color={colors.ink} />
      </Pressable><Text style={[styles.title, { color: colors.ink }]}>{titles[page]}</Text></View> : undefined}>
    <View style={[styles.body, (page === 'models' || (page === 'permissions' && scrollPermissions)) && styles.modelBody]}>
      {props.error ? <View style={styles.notice}><Text accessibilityRole="alert" style={[styles.detail, { color: colors.bad }]}>{props.error}</Text>
        <Pressable onPress={props.onRetry} disabled={readLocked} accessibilityRole="button"><Text style={[styles.label, { color: colors.accent }]}>{t('Retry', { ns: 'common' })}</Text></Pressable></View> : null}
      {props.running ? <Text style={[styles.detail, { color: colors.inkSecondary }]}>{t('Finish or stop the current task before changing settings.')}</Text> : null}
      {page === 'overview' ? <>
        {row('model', t('Model'), () => setPage('models'), { value: modelName })}
        {props.thinkingLevels.length ? row('thinking', t('Thinking Level'), () => setPage('thinking'), { value: props.thinkingLevel ? t(`thinking_${props.thinkingLevel}`) : t('Computer settings') }) : null}
        {props.fastMode?.available ? row('speed', t('Speed'), () => setPage('speed'), { value: props.fastMode.enabled === null ? t('Computer settings') : props.fastMode.enabled ? t('Fast') : t('Standard') }) : null}
        {props.permissions ? row('permissions', t('Permissions', { ns: 'common' }), () => setPage('permissions'), { value: permissionPending ? undefined : permissionLabel, warning: props.permissions.mode === 'full-access' }) : null}
        {props.contextRemainingPercent != null ? fact('context', t('Context remaining: {{percent}}%', { percent: props.contextRemainingPercent })) : null}
        {props.project ? fact('project', t('Project'), props.project.label, `${t('Project')}: ${props.project.path}`) : null}
      </> : null}
      {page === 'models' ? <>
        <SearchInput inSheet appearance="quiet" testID="runtime-settings-search" value={query} onChangeText={setQuery}
          placeholder={t('Search models...')} onClear={() => setQuery('')} />
        {props.loading && !props.models.length ? <ListSkeleton testID="runtime-settings-model-loading" accessibilityLabel={t('Loading models...')}
          rows={6} trailing="none" style={styles.modelSkeleton} /> : <BottomSheetFlatList<ModelInfo> testID="runtime-settings-model-list" data={filteredModels}
          keyExtractor={model => `${model.provider}/${model.id}`} initialNumToRender={12} maxToRenderPerBatch={12} windowSize={5}
          removeClippedSubviews={false} keyboardShouldPersistTaps="handled" style={styles.modelList}
          renderItem={({ item: model }) => row(`model-${model.provider}-${model.id}`, model.resolvedModel || model.name || model.id,
            () => props.onSelectModel(model), { checked: selected === model,
              detail: model.resolvedModel && model.name !== model.resolvedModel ? model.name : undefined })}
          ListEmptyComponent={<Text style={[styles.detail, { color: colors.inkSecondary }]}>{t('No models found')}</Text>} />}
      </> : null}
      {page === 'thinking' ? props.thinkingLevels.map(level => row(`thinking-${level}`, t(`thinking_${level}`), () => props.onSelectThinking(level), { checked: level === props.thinkingLevel })) : null}
      {page === 'speed' ? <>
        {row('speed-standard', t('Standard'), () => props.onSelectFastMode(false), { checked: props.fastMode?.enabled === false })}
        {row('speed-fast', t('Fast'), () => props.onSelectFastMode(true), { checked: props.fastMode?.enabled === true, detail: t('Faster replies may use more of your plan.') })}
      </> : null}
      {page === 'permissions' ? <PermissionBody {...(scrollPermissions ? { contentContainerStyle: styles.permissionBody } : {})}>
        {requiresPermissions ? <Text accessibilityRole="alert" style={[styles.detail, { color: colors.warn }]}>{t('Choose permissions again before sending.')}</Text> : null}
        {settledUnavailable.current ? <Text style={[styles.detail, { color: colors.inkSecondary }]}>{t('Permission changes are unavailable for this conversation. Check Codex on your computer.')}</Text> : null}
        {props.permissions?.unencryptedTransport ? <Text style={[styles.detail, { color: colors.inkSecondary }]}>{t('This connection is not encrypted. Use a trusted network or switch to Relay.')}</Text> : null}
        <View testID="runtime-settings-permission-summary" style={styles.permissionSummary}>{permissionPending ? <Shield size={22} color={colors.inkTertiary} /> : permissionUnknown ? <ShieldQuestionMark size={22} color={colors.inkSecondary} /> : props.permissions?.mode === 'full-access' ? <ShieldAlert size={22} color={colors.warn} /> : <Shield size={22} color={colors.inkSecondary} />}
          <Text style={[styles.detail, styles.permissionSummaryText, { color: colors.inkSecondary }]}>{permissionPending ? t('Applies to this conversation.') : `${permissionLabel} · ${t('Applies to this conversation.')}`}</Text>
          {permissionUnknown && !permissionPending && !props.error ? <Button testID="runtime-settings-permissions-retry" onPress={props.onRetry}
            disabled={readLocked} variant="text" size="md" icon={RefreshCw} label={t('Retry', { ns: 'common' })}
            textStyle={styles.detail} style={styles.permissionRetry} /> : null}
        </View>
        {(props.permissions?.availableModes ?? ['workspace', 'read-only', 'full-access'] as SessionPermissionMode[]).map(mode => row(`permission-${mode}`, permissionLabels[mode], () => props.onSelectPermissions(mode), {
          checked: !requiresPermissions && props.permissions?.mode === mode, disabled: !props.permissions?.available, warning: mode === 'full-access',
          detail: mode === 'workspace' ? t('Work in the project. Ask before broader access.') : mode === 'read-only' ? t('Read files. Ask before making changes.') : t('Run commands and change files without asking.'),
        }))}
      </PermissionBody> : null}
    </View>
  </Sheet>;
}

function pageForScroll(permissionsOnly: boolean | undefined, fontScale: number, height: number): boolean {
  return permissionsOnly === true && (fontScale > 1.3 || height < 700);
}

const styles = StyleSheet.create({
  body: { paddingHorizontal: Space.xl, paddingBottom: Space.xl },
  modelBody: { flex: 1, minHeight: 0 },
  modelList: { flex: 1, marginTop: Space.sm },
  modelSkeleton: { marginTop: Space.sm, paddingHorizontal: Space.sm },
  row:{ minHeight: ControlSize.settingsRow, flexDirection: 'row', alignItems: 'center', gap: Space.md, paddingVertical: Space.md, paddingHorizontal: Space.sm, borderRadius: Radius.settingsGroup },
  rowText: { flex: 1, minWidth: 0, gap: Space.xs },
  label: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.semibold },
  detail: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
  value: { flexShrink: 1, maxWidth: '55%', fontSize: FontSize.secondary, lineHeight: LineHeight.secondary },
  // A fact has no chevron and a short label, so a path keeps more of itself.
  factValue: { maxWidth: '78%' },
  // The spinner of a write in flight takes the radio's exact box, so the row never reflows.
  radioSlot: { width: 22, height: 22, alignItems: 'center', justifyContent: 'center' },
  radio: { borderRadius: Radius.full, borderWidth: BorderWidth.strong },
  heading: { flexDirection: 'row', alignItems: 'center', gap: Space.xs },
  back: { width: HitSize.md, height: HitSize.md, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: FontSize.title, lineHeight: LineHeight.title, fontWeight: FontWeight.semibold },
  notice: { paddingVertical: Space.md, gap: Space.sm },
  permissionBody: { paddingBottom: Space.lg },
  permissionSummaryText: { flex: 1, minWidth: 0 },
  permissionRetry: { flexShrink: 0 },
  // A settings row tall enough for the 44-point Retry: an unknown result never changes the sheet height.
  permissionSummary: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: ControlSize.settingsRow, paddingVertical: Space.xs },
});
