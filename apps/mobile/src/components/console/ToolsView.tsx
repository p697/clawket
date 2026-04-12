import React, { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  Alert,
  FlatList,
  RefreshControl,
  StyleSheet,
  Switch,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronDown, ChevronRight, Save } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { EmptyState, LoadingState, ScreenHeader, SearchInput } from '../ui';
import { useAppContext } from '../../contexts/AppContext';
import { useGatewayPatch } from '../../hooks/useGatewayPatch';
import { analyticsEvents } from '../../services/analytics/events';
import { GatewayClient } from '../../services/gateway';
import { loadGatewayToolsConfigBundle } from '../../services/gateway-tools';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import type { ToolCatalogEntry, ToolCatalogGroup } from '../../types';
import {
  type AgentToolsConfig,
  type ToolProfileId,
  computeToolToggle,
  detectActiveProfile,
  isToolEnabled,
} from '../../utils/toolPolicy';

type ListRow =
  | { type: 'group-header'; group: ToolCatalogGroup; expanded: boolean }
  | { type: 'tool'; tool: ToolCatalogEntry; groupId: string };

export type ToolsViewHandle = {
  refresh: () => void;
};

type Props = {
  gateway: GatewayClient;
  agentId: string;
  agentName?: string;
  topInset: number;
  onBack: () => void;
  hideHeader?: boolean;
  gatewayDisabledToolIds?: Set<string>;
};

const SOURCE_EMOJI: Record<string, string> = {
  core: '🔧',
  plugin: '🔌',
};

// PROFILE_PRESETS moved inside component as profilePresets (useMemo) for i18n access

function profileBadgeColor(profile: string): string {
  switch (profile) {
    case 'full': return '#34C759';
    case 'coding': return '#007AFF';
    case 'messaging': return '#FF9500';
    case 'minimal': return '#8E8E93';
    default: return '#8E8E93';
  }
}

/** Extract agent tools config from parsed gateway config. */
function extractAgentToolsConfig(
  config: Record<string, unknown> | null,
  agentId: string,
): AgentToolsConfig {
  if (!config) return {};
  const agents = config.agents as Record<string, unknown> | undefined;
  if (!agents) return {};
  const list = agents.list as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(list)) return {};
  const agent = list.find((a) => a.id === agentId || a.key === agentId);
  if (!agent) return {};
  const tools = agent.tools as Record<string, unknown> | undefined;
  if (!tools) return {};
  return {
    profile: typeof tools.profile === 'string' ? tools.profile : undefined,
    allow: Array.isArray(tools.allow) ? tools.allow as string[] : undefined,
    alsoAllow: Array.isArray(tools.alsoAllow) ? tools.alsoAllow as string[] : undefined,
    deny: Array.isArray(tools.deny) ? tools.deny as string[] : undefined,
  };
}

/** Find agent id field for merge-patch. */
function findAgentIdField(
  config: Record<string, unknown> | null,
  agentId: string,
): string | null {
  if (!config) return null;
  const agents = config.agents as Record<string, unknown> | undefined;
  if (!agents) return null;
  const list = agents.list as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(list)) return null;
  const agent = list.find((a) => a.id === agentId || a.key === agentId);
  if (!agent) return null;
  return (agent.id ?? agent.key ?? agentId) as string;
}

/** Compute a diff summary between saved and draft configs. */
function computeDiffSummary(
  allToolIds: string[],
  saved: AgentToolsConfig,
  draft: AgentToolsConfig,
): { enabled: number; disabled: number; totalChanged: number } {
  let enabled = 0;
  let disabled = 0;
  for (const id of allToolIds) {
    const wasBefore = isToolEnabled(id, saved);
    const isAfter = isToolEnabled(id, draft);
    if (wasBefore && !isAfter) disabled++;
    else if (!wasBefore && isAfter) enabled++;
  }
  return { enabled, disabled, totalChanged: enabled + disabled };
}

const EMPTY_DISABLED_SET = new Set<string>();

export const ToolsView = React.forwardRef<ToolsViewHandle, Props>(function ToolsView(
  { gateway, agentId, agentName, topInset, onBack, hideHeader, gatewayDisabledToolIds = EMPTY_DISABLED_SET },
  ref,
) {
  const { gatewayEpoch } = useAppContext();
  const { t } = useTranslation('console');
  const { theme } = useAppTheme();
  const profilePresets = useMemo<{ key: ToolProfileId; label: string }[]>(() => [
    { key: 'full', label: t('Full') },
    { key: 'coding', label: t('Coding') },
    { key: 'messaging', label: t('Messaging') },
    { key: 'minimal', label: t('Minimal') },
  ], [t]);
  const styles = useMemo(() => createStyles(theme.colors), [theme]);

  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [selectedTool, setSelectedTool] = useState<ToolCatalogEntry | null>(null);
  const [search, setSearch] = useState('');

  const [groups, setGroups] = useState<ToolCatalogGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedConfig, setSavedConfig] = useState<AgentToolsConfig>({});
  const [draftConfig, setDraftConfig] = useState<AgentToolsConfig>({});
  const [configHash, setConfigHash] = useState<string | null>(null);
  const [rawConfig, setRawConfig] = useState<Record<string, unknown> | null>(null);
  const [saving, setSaving] = useState(false);
  const { patchWithRestart } = useGatewayPatch(gateway);
  const configHashRef = useRef<string | null>(null);

  const loadData = useCallback(async (mode: 'initial' | 'refresh' = 'initial') => {
    if (mode === 'initial') setLoading(true);
    if (mode === 'refresh') setRefreshing(true);

    try {
      const bundle = await loadGatewayToolsConfigBundle(gateway, agentId);
      const extracted = extractAgentToolsConfig(bundle.config, agentId);
      setGroups(bundle.catalog.groups);
      setRawConfig(bundle.config);
      setConfigHash(bundle.configHash);
      setSavedConfig(extracted);
      setDraftConfig(extracted);
      configHashRef.current = bundle.configHash;
      setError(null);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load tools');
    } finally {
      if (mode === 'initial') setLoading(false);
      if (mode === 'refresh') setRefreshing(false);
    }
  }, [agentId, gateway, gatewayEpoch]);

  useImperativeHandle(ref, () => ({
    refresh: () => { void loadData('refresh'); },
  }), [loadData]);

  useEffect(() => { loadData('initial'); }, [loadData]);

  const allToolIds = useMemo(
    () => groups.flatMap((g) => g.tools.map((t) => t.id)),
    [groups],
  );

  const totalTools = allToolIds.length;
  const draftEnabledCount = useMemo(
    () => allToolIds.filter((id) => isToolEnabled(id, draftConfig)).length,
    [allToolIds, draftConfig],
  );

  const hasExplicitAllow = !!(savedConfig.allow && savedConfig.allow.length > 0);

  const activeProfile = useMemo(
    () => detectActiveProfile(draftConfig, allToolIds),
    [draftConfig, allToolIds],
  );

  // Detect whether draft differs from saved
  const diffSummary = useMemo(
    () => computeDiffSummary(allToolIds, savedConfig, draftConfig),
    [allToolIds, savedConfig, draftConfig],
  );
  const hasPendingChanges = diffSummary.totalChanged > 0;

  // --- Actions (all local, no network) ---

  const handleToggleTool = useCallback((toolId: string, newValue: boolean) => {
    if (hasExplicitAllow) return;
    setDraftConfig((current) => {
      const { alsoAllow, deny } = computeToolToggle(toolId, newValue, current);
      return { ...current, alsoAllow, deny };
    });
  }, [hasExplicitAllow]);

  const handlePresetPress = useCallback((profileId: ToolProfileId) => {
    if (hasExplicitAllow) return;
    const next = { profile: profileId, alsoAllow: [], deny: [] };
    setDraftConfig(next);
  }, [hasExplicitAllow]);

  const handleDiscard = useCallback(() => {
    setDraftConfig(savedConfig);
  }, [savedConfig]);

  // --- Save with confirmation ---

  const handleSave = useCallback(() => {
    if (!hasPendingChanges || saving) return;

    const lines: string[] = [];
    lines.push(t('common:This will restart Gateway. Continue?'));
    if (diffSummary.enabled > 0) {
      lines.push(t('Enable {{count}} tools', { count: diffSummary.enabled }));
    }
    if (diffSummary.disabled > 0) {
      lines.push(t('Disable {{count}} tools', { count: diffSummary.disabled }));
    }
    lines.push(`\n${t('{{enabled}}/{{total}} tools will be active after saving.', { enabled: draftEnabledCount, total: totalTools })}`);

    Alert.alert(
      t('Apply {{count}} changes?', { count: diffSummary.totalChanged }),
      lines.join('\n'),
      [
        { text: t('common:Cancel'), style: 'cancel' },
        { text: t('common:Save'), style: 'default', onPress: commitSave },
      ],
    );
  }, [hasPendingChanges, saving, diffSummary, draftEnabledCount, totalTools]);

  const commitSave = useCallback(async () => {
    const hash = configHashRef.current;
    if (!hash) return;

    analyticsEvents.toolsSaveTapped({
      changed_count: diffSummary.totalChanged,
      enabled_count: draftEnabledCount,
      total_count: totalTools,
    });

    const agentIdField = findAgentIdField(rawConfig, agentId);
    if (!agentIdField) {
      Alert.alert(t('common:Error'), t('Agent not found in config.'));
      return;
    }

    const patch = {
      agents: {
        list: [
          {
            id: agentIdField,
            tools: {
              profile: draftConfig.profile ?? 'full',
              alsoAllow: draftConfig.alsoAllow ?? [],
              deny: draftConfig.deny ?? [],
            },
          },
        ],
      },
    };

    setSaving(true);
    await patchWithRestart({
      patch,
      configHash: hash,
      onSuccess: async () => {
        const configPayload = await gateway.getConfig();
        const next = configPayload.config ? extractAgentToolsConfig(configPayload.config, agentId) : savedConfig;
        setRawConfig(configPayload.config ?? rawConfig);
        setSavedConfig(next);
        setDraftConfig(next);
        setConfigHash(configPayload.hash ?? configHash);
        if (configPayload.hash) configHashRef.current = configPayload.hash;
      },
      onError: () => {
        void loadData('refresh');
      },
    });
    setSaving(false);
  }, [agentId, configHash, diffSummary.totalChanged, draftConfig, draftEnabledCount, gateway, loadData, patchWithRestart, rawConfig, savedConfig, t, totalTools]);

  // --- List ---

  const toggleGroup = useCallback((groupId: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const rows = useMemo((): ListRow[] => {
    const q = search.trim().toLowerCase();
    const out: ListRow[] = [];
    for (const group of groups) {
      const filteredTools = q
        ? group.tools.filter((t) =>
            t.label.toLowerCase().includes(q)
            || t.id.toLowerCase().includes(q)
            || t.description.toLowerCase().includes(q)
            || group.label.toLowerCase().includes(q),
          )
        : group.tools;
      if (q && filteredTools.length === 0) continue;
      const expanded = !collapsedGroups.has(group.id);
      const headerGroup = q ? { ...group, tools: filteredTools } : group;
      out.push({ type: 'group-header', group: headerGroup, expanded });
      if (expanded) {
        for (const tool of filteredTools) {
          out.push({ type: 'tool', tool, groupId: group.id });
        }
      }
    }
    return out;
  }, [groups, collapsedGroups, search]);

  const renderRow = useCallback(({ item }: { item: ListRow }) => {
    if (item.type === 'group-header') {
      const { group, expanded } = item;
      const Icon = expanded ? ChevronDown : ChevronRight;
      return (
        <TouchableOpacity
          style={styles.groupHeader}
          onPress={() => toggleGroup(group.id)}
          activeOpacity={0.7}
        >
          <Text style={styles.groupEmoji}>{SOURCE_EMOJI[group.source] ?? '📦'}</Text>
          <View style={styles.groupInfo}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <Text style={styles.groupCount}>{t('{{count}} tools', { count: group.tools.length })}</Text>
          </View>
          <Icon size={16} color={theme.colors.textMuted} strokeWidth={2} />
        </TouchableOpacity>
      );
    }

    const { tool } = item;
    const isSelected = selectedTool?.id === tool.id;
    const enabled = isToolEnabled(tool.id, draftConfig);
    const isGatewayDisabled = gatewayDisabledToolIds.has(tool.id);
    return (
      <TouchableOpacity
        style={styles.toolRow}
        onPress={() => setSelectedTool(isSelected ? null : tool)}
        activeOpacity={0.7}
      >
        <View style={styles.toolMain}>
          <Text style={[styles.toolName, (!enabled || isGatewayDisabled) && styles.toolNameDisabled]}>
            {tool.label}
          </Text>
          <Text style={styles.toolDesc} numberOfLines={isSelected ? undefined : 1}>{tool.description}</Text>
          {isGatewayDisabled ? (
            <Text style={styles.gatewayDisabledHint}>{t('Disabled in Basics')}</Text>
          ) : null}
          {isSelected && tool.defaultProfiles.length > 0 ? (
            <View style={styles.profileRow}>
              {tool.defaultProfiles.map((p) => (
                <View key={p} style={[styles.profileBadge, { backgroundColor: profileBadgeColor(p) + '20', borderColor: profileBadgeColor(p) + '40' }]}>
                  <Text style={[styles.profileText, { color: profileBadgeColor(p) }]}>{p}</Text>
                </View>
              ))}
            </View>
          ) : null}
          {isSelected ? (
            <View style={styles.metaRow}>
              <Text style={styles.metaLabel}>{'ID: '}</Text>
              <Text style={styles.metaValue}>{tool.id}</Text>
              {tool.source === 'plugin' && tool.pluginId ? (
                <>
                  <Text style={styles.metaLabel}>{'  Plugin: '}</Text>
                  <Text style={styles.metaValue}>{tool.pluginId}</Text>
                </>
              ) : null}
            </View>
          ) : null}
        </View>
        <View style={styles.switchContainer}>
          {tool.source === 'plugin' ? (
            <View style={styles.pluginTag}>
              <Text style={styles.pluginTagText}>{t('plugin')}</Text>
            </View>
          ) : null}
          <Switch
            value={enabled}
            onValueChange={(val) => handleToggleTool(tool.id, val)}
            disabled={hasExplicitAllow || isGatewayDisabled}
            trackColor={{ false: theme.colors.surfaceMuted, true: theme.colors.primary }}
            thumbColor={theme.colors.primaryText}
            style={styles.switch}
          />
        </View>
      </TouchableOpacity>
    );
  }, [styles, theme.colors, toggleGroup, selectedTool, draftConfig, handleToggleTool, hasExplicitAllow, gatewayDisabledToolIds]);

  const keyExtractor = useCallback((item: ListRow, index: number) => {
    return item.type === 'group-header' ? `g:${item.group.id}` : `t:${item.tool.id}:${index}`;
  }, []);

  const headerTitle = t('Tools ({{enabled}}/{{total}})', { enabled: draftEnabledCount, total: totalTools });

  if (loading) {
    return (
      <View style={styles.root}>
        {!hideHeader && <ScreenHeader title={t('Tools')} topInset={topInset} onBack={onBack} />}
        <LoadingState message={t('Loading tools...')} />
      </View>
    );
  }

  if (error && groups.length === 0) {
    return (
      <View style={styles.root}>
        {!hideHeader && <ScreenHeader title={t('Tools')} topInset={topInset} onBack={onBack} />}
        <EmptyState title={error} />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      {!hideHeader && <ScreenHeader title={headerTitle} topInset={topInset} onBack={onBack} />}

      {agentName ? (
        <View style={styles.agentScopeBanner}>
          <Text style={styles.agentScopeText}>
            {t('Settings below only apply to the selected agent:')}
            {' '}<Text style={styles.agentScopeName}>{agentName}</Text>
          </Text>
        </View>
      ) : null}

      {/* Quick presets */}
      <View style={styles.presetsRow}>
        {profilePresets.map((preset) => {
          const isActive = activeProfile === preset.key;
          return (
            <TouchableOpacity
              key={preset.key}
              style={[
                styles.presetButton,
                isActive && { backgroundColor: theme.colors.primary },
              ]}
              onPress={() => handlePresetPress(preset.key)}
              activeOpacity={0.7}
              disabled={hasExplicitAllow}
            >
              <Text
                style={[
                  styles.presetLabel,
                  isActive && { color: theme.colors.primaryText },
                ]}
              >
                {preset.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <SearchInput
        value={search}
        onChangeText={setSearch}
        placeholder={t('Search tools...')}
        style={styles.searchWrap}
      />

      {hasExplicitAllow ? (
        <View style={styles.readOnlyBanner}>
          <Text style={styles.readOnlyText}>
            {t('This agent uses an explicit allow list. Toggles are read-only.')}
          </Text>
        </View>
      ) : null}

      <FlatList
        data={rows}
        renderItem={renderRow}
        keyExtractor={keyExtractor}
        contentContainerStyle={styles.list}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={() => loadData('refresh')} tintColor={theme.colors.textMuted} />
        }
      />

      {/* Sticky bottom bar: Discard + Save */}
      {hasPendingChanges && !hasExplicitAllow ? (
        <View style={styles.bottomBar}>
          <TouchableOpacity
            style={styles.discardButton}
            onPress={handleDiscard}
            activeOpacity={0.7}
          >
            <Text style={styles.discardLabel}>{t('Discard')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.saveButton, saving && styles.saveButtonDisabled]}
            onPress={handleSave}
            activeOpacity={0.7}
            disabled={saving}
          >
            <Save size={15} color={theme.colors.primaryText} strokeWidth={2} />
            <Text style={styles.saveLabel}>
              {saving ? t('Saving...') : t('Save ({{count}})', { count: diffSummary.totalChanged })}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor: colors.background,
    },
    list: {
      paddingHorizontal: Space.lg,
      paddingBottom: Space.xxxl + 60, // extra room for sticky bottom bar
    },
    searchWrap: {
      marginHorizontal: Space.lg,
      marginTop: Space.sm,
    },
    // Presets row
    presetsRow: {
      flexDirection: 'row',
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.xs,
      gap: Space.sm,
    },
    presetButton: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: Space.sm,
      borderRadius: Radius.sm,
      backgroundColor: colors.surface,
    },
    presetLabel: {
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
    },
    // Agent scope banner
    agentScopeBanner: {
      marginHorizontal: Space.lg,
      marginTop: Space.sm,
      paddingHorizontal: Space.md,
      paddingVertical: Space.xs + 2,
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.sm,
    },
    agentScopeText: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
    },
    agentScopeName: {
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
    },
    // Read-only banner
    readOnlyBanner: {
      marginHorizontal: Space.lg,
      marginBottom: Space.sm,
      paddingHorizontal: Space.md,
      paddingVertical: Space.xs + 2,
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.sm,
    },
    readOnlyText: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
    },
    // Group header
    groupHeader: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: Space.md,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    groupEmoji: {
      fontSize: 20,
      marginRight: Space.sm + 2,
    },
    groupInfo: {
      flex: 1,
    },
    groupLabel: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    groupCount: {
      fontSize: FontSize.xs + 1,
      color: colors.textMuted,
      marginTop: 1,
    },
    // Tool row
    toolRow: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      paddingVertical: Space.sm + 4,
      paddingLeft: Space.xl + Space.sm,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.border,
    },
    toolMain: {
      flex: 1,
    },
    toolName: {
      fontSize: FontSize.sm + 1,
      fontWeight: FontWeight.medium,
      color: colors.text,
    },
    toolNameDisabled: {
      color: colors.textSubtle,
    },
    toolDesc: {
      fontSize: FontSize.xs + 1,
      color: colors.textMuted,
      marginTop: 2,
    },
    gatewayDisabledHint: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
      marginTop: 2,
    },
    profileRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 6,
      marginTop: Space.xs + 2,
    },
    profileBadge: {
      paddingHorizontal: 8,
      paddingVertical: 2,
      borderRadius: Radius.sm,
      borderWidth: 1,
    },
    profileText: {
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    metaRow: {
      flexDirection: 'row',
      alignItems: 'center',
      marginTop: Space.xs,
    },
    metaLabel: {
      fontSize: FontSize.xs,
      color: colors.textSubtle,
    },
    metaValue: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
      fontFamily: 'monospace',
    },
    switchContainer: {
      alignItems: 'flex-end',
      marginLeft: Space.sm,
      paddingTop: 2,
    },
    switch: {
      transform: [{ scaleX: 0.8 }, { scaleY: 0.8 }],
    },
    pluginTag: {
      backgroundColor: colors.surface,
      paddingHorizontal: 6,
      paddingVertical: 2,
      borderRadius: Radius.sm,
      marginBottom: 4,
    },
    pluginTagText: {
      fontSize: FontSize.xs,
      color: colors.textMuted,
      fontWeight: FontWeight.medium,
    },
    // Bottom sticky bar
    bottomBar: {
      flexDirection: 'row',
      paddingHorizontal: Space.lg,
      paddingTop: Space.md,
      paddingBottom: Space.xl,
      gap: Space.sm,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.border,
      backgroundColor: colors.background,
    },
    discardButton: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 11,
      borderRadius: Radius.md,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.border,
    },
    discardLabel: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.textMuted,
    },
    saveButton: {
      flex: 2,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
      paddingVertical: 11,
      borderRadius: Radius.md,
      backgroundColor: colors.primary,
    },
    saveButtonDisabled: {
      opacity: 0.6,
    },
    saveLabel: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.primaryText,
    },
  });
}
