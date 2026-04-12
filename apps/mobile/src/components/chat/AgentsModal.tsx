import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Animated, Easing, Platform, Pressable, StyleSheet, Text, TouchableOpacity, View, useWindowDimensions } from 'react-native';
import * as Haptics from 'expo-haptics';
import { useTranslation } from 'react-i18next';
import { BottomSheetBackdrop, BottomSheetModal, BottomSheetScrollView } from '@gorhom/bottom-sheet';
import { Check, ChevronRight, Cloud, Link2, Plus, Table2, X } from 'lucide-react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FullWindowOverlay } from 'react-native-screens';
import type { GatewayMode } from '../../types';
import { getGatewayModeLabel } from '../../services/gateway-backends';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { AgentActivityStatus } from '../../screens/ChatScreen/hooks/agentActivity';
import { getDisplayAgentEmoji } from '../../utils/agent-emoji';
import { formatToolActivity } from '../../utils/tool-display';
import { IconButton } from '../ui';

export type AgentRowData = {
  agentId: string;
  displayName: string;
  emoji: string | null;
  avatarUri: string | null;
  status: AgentActivityStatus;
  previewText: string | null;
  toolName: string | null;
  isCurrent: boolean;
};

export type GatewayRowData = {
  configId: string;
  name: string;
  mode: GatewayMode;
  url: string;
  isCurrent: boolean;
};

type Props = {
  visible: boolean;
  onClose: () => void;
  agents: AgentRowData[];
  gateways?: GatewayRowData[];
  gatewayLoading?: boolean;
  onSelectAgent: (agentId: string) => void;
  onSelectGateway?: (configId: string) => void | Promise<void>;
  onAddGateway?: () => void;
  onNewAgent?: () => void;
  onManageAgents?: () => void;
  onOpenAgentSessionsBoard?: () => void;
};

function ModalContainer({ children }: React.PropsWithChildren): React.JSX.Element {
  if (Platform.OS !== 'ios') {
    return <>{children}</>;
  }

  return (
    <FullWindowOverlay>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        {children}
      </View>
    </FullWindowOverlay>
  );
}

function statusLabel(
  status: AgentActivityStatus,
  previewText: string | null,
  toolName: string | null,
  t: (key: string, options?: Record<string, unknown>) => string,
): string | null {
  if (status === 'streaming') return previewText || t('Thinking');
  if (status === 'tool_calling') return toolName ? formatToolActivity(toolName, t) : t('Using tool');
  return previewText || null;
}

function TypingDots({ color }: { color: string }) {
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animate = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: 1, duration: 300, easing: Easing.ease, useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 300, easing: Easing.ease, useNativeDriver: true }),
          Animated.delay(600 - delay),
        ]),
      );
    const a1 = animate(dot1, 0);
    const a2 = animate(dot2, 200);
    const a3 = animate(dot3, 400);
    a1.start();
    a2.start();
    a3.start();
    return () => {
      a1.stop();
      a2.stop();
      a3.stop();
    };
  }, [dot1, dot2, dot3]);

  const dotStyle = (anim: Animated.Value) => ({
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: color,
    marginHorizontal: 1.5,
    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }),
    transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [0, -2] }) }],
  });

  return (
    <View style={stylesStatic.typingDotsRow}>
      <Animated.View style={dotStyle(dot1)} />
      <Animated.View style={dotStyle(dot2)} />
      <Animated.View style={dotStyle(dot3)} />
    </View>
  );
}

export function AgentsModal({
  visible,
  onClose,
  agents,
  gateways = [],
  gatewayLoading = false,
  onSelectAgent,
  onSelectGateway,
  onAddGateway,
  onNewAgent,
  onManageAgents,
  onOpenAgentSessionsBoard,
}: Props): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common', 'config']);
  const { theme } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { height: windowHeight } = useWindowDimensions();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const bottomSheetRef = useRef<BottomSheetModal>(null);
  const snapPoints = useMemo(() => ['72%', '92%'], []);
  const hasGatewayConnections = gateways.length > 0;
  const hasGatewaySection = gatewayLoading || hasGatewayConnections;
  const shouldShowAgentSection = hasGatewayConnections;
  const headerActionWidth = onOpenAgentSessionsBoard ? 80 : 40;
  const minimumContentHeight = useMemo(
    () => Math.max(280, Math.floor(windowHeight / 3)),
    [windowHeight],
  );

  useEffect(() => {
    if (visible) {
      requestAnimationFrame(() => {
        bottomSheetRef.current?.present();
      });
      return;
    }

    bottomSheetRef.current?.dismiss();
  }, [visible]);

  const handleDismiss = useCallback(() => {
    onClose();
  }, [onClose]);

  const renderBackdrop = useCallback(
    (props: React.ComponentProps<typeof BottomSheetBackdrop>) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        opacity={theme.scheme === 'dark' ? 0.58 : 0.34}
        pressBehavior="close"
      />
    ),
    [theme.scheme],
  );

  const labelColor = useCallback((status: AgentActivityStatus): string => {
    if (status === 'streaming') return theme.colors.primary;
    if (status === 'tool_calling') return theme.colors.warning;
    return theme.colors.textMuted;
  }, [theme.colors.primary, theme.colors.textMuted, theme.colors.warning]);

  return (
    <ModalContainer>
      <BottomSheetModal
        ref={bottomSheetRef}
        enablePanDownToClose
        enableDynamicSizing={false}
        snapPoints={snapPoints}
        topInset={insets.top}
        onDismiss={handleDismiss}
        backdropComponent={renderBackdrop}
        handleIndicatorStyle={styles.handleIndicator}
        backgroundStyle={styles.sheetBackground}
      >
        <View style={styles.header}>
          <View style={[styles.headerSpacer, { width: headerActionWidth }]} />
          <Text style={styles.title} numberOfLines={1}>{t('Agents & Gateways')}</Text>
          <View style={styles.headerActions}>
            {onOpenAgentSessionsBoard ? (
              <IconButton
                icon={<Table2 size={20} color={theme.colors.textMuted} strokeWidth={2} />}
                onPress={() => {
                  void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                  bottomSheetRef.current?.dismiss();
                  onOpenAgentSessionsBoard();
                }}
                size={40}
              />
            ) : null}
            <IconButton
              icon={<X size={20} color={theme.colors.textMuted} strokeWidth={2} />}
              onPress={() => bottomSheetRef.current?.dismiss()}
              size={40}
            />
          </View>
        </View>

        <BottomSheetScrollView
          contentContainerStyle={[
            styles.content,
            { minHeight: minimumContentHeight },
            { paddingBottom: Math.max(insets.bottom, Space.lg) + Space.lg },
          ]}
        >
          {shouldShowAgentSection ? (
            <View style={styles.agentGroup}>
              <View style={styles.agentSection}>
                <Text style={styles.sectionLabel}>{t('common:Agents')}</Text>
                <View style={styles.sectionCard}>
                  {agents.map((agent, index) => (
                    <React.Fragment key={agent.agentId}>
                      <Pressable
                        onPress={() => {
                          if (agent.isCurrent) return;
                          onSelectAgent(agent.agentId);
                          bottomSheetRef.current?.dismiss();
                        }}
                        style={({ pressed }) => [
                          styles.agentRow,
                          pressed && !agent.isCurrent && styles.rowPressed,
                        ]}
                      >
                        <Text style={styles.emoji}>{getDisplayAgentEmoji(agent.emoji)}</Text>
                        <View style={styles.info}>
                          <View style={styles.agentTitleRow}>
                            <Text style={styles.name} numberOfLines={1}>{agent.displayName}</Text>
                            {agent.isCurrent ? (
                              <View style={styles.currentBadge}>
                                <Text style={styles.currentBadgeText}>{t('Current')}</Text>
                              </View>
                            ) : null}
                          </View>
                          {(() => {
                            const label = statusLabel(agent.status, agent.previewText, agent.toolName, t);
                            const isActive = agent.status === 'streaming' || agent.status === 'tool_calling';
                            return label ? (
                              <View style={styles.activityRow}>
                                <Text
                                  style={[styles.activity, { color: labelColor(agent.status) }]}
                                  numberOfLines={1}
                                >
                                  {label}
                                </Text>
                                {isActive ? <TypingDots color={labelColor(agent.status)} /> : null}
                              </View>
                            ) : null;
                          })()}
                        </View>
                        {agent.isCurrent ? (
                          <Check size={18} color={theme.colors.primary} strokeWidth={2.4} />
                        ) : (
                          <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
                        )}
                      </Pressable>
                      {index < agents.length - 1 ? <View style={styles.divider} /> : null}
                    </React.Fragment>
                  ))}
                </View>
              </View>

              {onNewAgent || onManageAgents ? (
                <View style={styles.agentActions}>
                  {onNewAgent ? (
                    <TouchableOpacity
                      style={styles.newAgentRow}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        bottomSheetRef.current?.dismiss();
                        onNewAgent();
                      }}
                      activeOpacity={0.7}
                    >
                      <Plus size={18} color={theme.colors.primary} strokeWidth={2} />
                      <Text style={styles.newAgentText}>{t('New Agent')}</Text>
                    </TouchableOpacity>
                  ) : null}
                  {onManageAgents ? (
                    <TouchableOpacity
                      style={styles.manageAgentsRow}
                      onPress={() => {
                        void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                        bottomSheetRef.current?.dismiss();
                        onManageAgents();
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.manageAgentsText}>{t('Manage All Agents')}</Text>
                    </TouchableOpacity>
                  ) : null}
                </View>
              ) : null}
            </View>
          ) : null}

          {hasGatewaySection ? (
            <View style={styles.section}>
              <Text style={styles.sectionLabel}>{t('Gateways')}</Text>
              <View style={styles.sectionCard}>
                {gatewayLoading ? (
                  <Text style={styles.loadingText}>{t('common:Loading...')}</Text>
                ) : (
                  gateways.map((gateway, index) => (
                    <React.Fragment key={gateway.configId}>
                      <Pressable
                        onPress={() => {
                          if (gateway.isCurrent) return;
                          void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                          void onSelectGateway?.(gateway.configId);
                          bottomSheetRef.current?.dismiss();
                        }}
                        style={({ pressed }) => [
                          styles.gatewayRow,
                          pressed && !gateway.isCurrent && styles.rowPressed,
                        ]}
                      >
                        <View style={styles.gatewayIconWrap}>
                          {gateway.mode === 'relay' ? (
                            <Cloud size={16} color={theme.colors.primary} strokeWidth={2} />
                          ) : (
                            <Link2 size={16} color={theme.colors.primary} strokeWidth={2} />
                          )}
                        </View>
                        <View style={styles.gatewayInfo}>
                          <View style={styles.gatewayTitleRow}>
                            <Text style={styles.gatewayName} numberOfLines={1}>{gateway.name}</Text>
                            {gateway.isCurrent ? (
                              <View style={styles.currentBadge}>
                                <Text style={styles.currentBadgeText}>{t('Current')}</Text>
                              </View>
                            ) : null}
                          </View>
                          <Text style={styles.activity} numberOfLines={1}>
                            {getGatewayModeLabel(gateway)}
                          </Text>
                        </View>
                        {gateway.isCurrent ? (
                          <Check size={18} color={theme.colors.primary} strokeWidth={2.4} />
                        ) : (
                          <ChevronRight size={16} color={theme.colors.textSubtle} strokeWidth={2} />
                        )}
                      </Pressable>
                      {index < gateways.length - 1 ? <View style={styles.divider} /> : null}
                    </React.Fragment>
                  ))
                )}
              </View>
              {onAddGateway ? (
                <TouchableOpacity
                  style={styles.addGatewayRow}
                  onPress={() => {
                    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                    bottomSheetRef.current?.dismiss();
                    onAddGateway();
                  }}
                  activeOpacity={0.7}
                >
                  <Plus size={18} color={theme.colors.primary} strokeWidth={2} />
                  <Text style={styles.addGatewayText}>{t('Add Connection', { ns: 'config' })}</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          ) : null}

        </BottomSheetScrollView>
      </BottomSheetModal>
    </ModalContainer>
  );
}

const stylesStatic = StyleSheet.create({
  typingDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginLeft: 4,
  },
});

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    handleIndicator: {
      width: 42,
      backgroundColor: colors.borderStrong,
    },
    sheetBackground: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: Radius.lg,
      borderTopRightRadius: Radius.lg,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: Space.lg,
      paddingTop: Space.sm,
      paddingBottom: Space.sm,
      gap: Space.sm,
    },
    headerSpacer: {
      height: 40,
    },
    headerActions: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    title: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.lg,
      fontWeight: FontWeight.semibold,
      textAlign: 'center',
    },
    content: {
      paddingHorizontal: Space.lg,
      gap: Space.lg,
    },
    section: {
      gap: Space.sm,
    },
    agentGroup: {
      gap: Space.sm,
    },
    agentActions: {
      gap: Space.sm,
    },
    agentSection: {
      gap: Space.sm,
    },
    sectionLabel: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
      letterSpacing: 0.6,
      textTransform: 'uppercase',
    },
    sectionCard: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.lg,
      overflow: 'hidden',
      borderWidth: 1,
      borderColor: colors.border,
    },
    gatewayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    agentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    rowPressed: {
      backgroundColor: colors.surface,
    },
    gatewayIconWrap: {
      width: 32,
      height: 32,
      borderRadius: Radius.md,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    gatewayInfo: {
      flex: 1,
    },
    gatewayTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    gatewayName: {
      flex: 1,
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    loadingText: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      paddingHorizontal: Space.md,
      paddingVertical: Space.md,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginLeft: Space.md,
    },
    emoji: {
      fontSize: FontSize.xxl,
      lineHeight: 28,
      width: 32,
      textAlign: 'center',
    },
    info: {
      flex: 1,
      gap: 2,
    },
    agentTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    name: {
      flex: 1,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    activityRow: {
      flexDirection: 'row',
      alignItems: 'center',
    },
    activity: {
      fontSize: FontSize.sm,
      flexShrink: 1,
    },
    currentBadge: {
      backgroundColor: colors.primarySoft,
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: Space.xs,
    },
    currentBadgeText: {
      color: colors.primary,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.medium,
    },
    newAgentRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
      paddingVertical: Space.md,
      borderRadius: Radius.lg,
      backgroundColor: colors.primarySoft,
    },
    manageAgentsRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: Space.md,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.surface,
    },
    addGatewayRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
      paddingVertical: Space.md,
      borderRadius: Radius.lg,
      backgroundColor: colors.primarySoft,
    },
    addGatewayText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      color: colors.primary,
    },
    newAgentText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      color: colors.primary,
    },
    manageAgentsText: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.medium,
      color: colors.text,
    },
  });
}
