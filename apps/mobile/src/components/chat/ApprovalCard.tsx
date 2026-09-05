import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Shield, ShieldCheck, ShieldX, Timer } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { AGENT_AVATAR_SLOT_WIDTH } from './messageLayout';

type ApprovalStatus = 'pending' | 'allowed' | 'denied' | 'expired';

type Props = {
  approvalId: string;
  command: string;
  cwd?: string;
  host?: string;
  expiresAtMs: number;
  status: ApprovalStatus;
  onResolve: (id: string, decision: 'allow-once' | 'allow-always' | 'deny') => void;
  reserveAvatarSlot?: boolean;
};

function formatCountdown(ms: number): string {
  if (ms <= 0) return '0s';
  const s = Math.ceil(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const remainS = s % 60;
  return `${m}m${remainS}s`;
}

export function ApprovalCard({
  approvalId,
  command,
  cwd,
  expiresAtMs,
  status,
  onResolve,
  reserveAvatarSlot = true,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors, reserveAvatarSlot), [reserveAvatarSlot, theme]);
  const [remaining, setRemaining] = useState(() => Math.max(0, expiresAtMs - Date.now()));

  useEffect(() => {
    if (status !== 'pending') return;
    const tick = () => {
      const left = Math.max(0, expiresAtMs - Date.now());
      setRemaining(left);
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [expiresAtMs, status]);

  const isPending = status === 'pending' && remaining > 0;

  // Resolved or expired state — show compact status
  if (!isPending) {
    const resolvedStatus = status === 'pending' ? 'expired' : status;
    const icon =
      resolvedStatus === 'allowed'
        ? <ShieldCheck size={14} color={theme.colors.good} strokeWidth={2} />
        : resolvedStatus === 'denied'
        ? <ShieldX size={14} color={theme.colors.bad} strokeWidth={2} />
        : <Timer size={14} color={theme.colors.inkTertiary} strokeWidth={2} />;
    const label =
      resolvedStatus === 'allowed' ? 'Allowed' : resolvedStatus === 'denied' ? 'Denied' : 'Expired';
    const labelColor =
      resolvedStatus === 'allowed'
        ? theme.colors.good
        : resolvedStatus === 'denied'
        ? theme.colors.bad
        : theme.colors.inkTertiary;

    return (
      <View style={styles.row}>
        <View style={styles.resolvedCard}>
          {icon}
          <Text style={[styles.resolvedText, { color: labelColor }]}>{label}</Text>
          <Text style={styles.resolvedCommand} numberOfLines={1}>$ {command}</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <View style={styles.card}>
        <View style={styles.header}>
          <Shield size={16} color={theme.colors.warn} strokeWidth={2} />
          <Text style={styles.title}>Command Approval</Text>
        </View>

        <View style={styles.commandBlock}>
          <Text style={styles.commandText} numberOfLines={3}>$ {command}</Text>
        </View>

        {!!cwd && (
          <Text style={styles.meta} numberOfLines={1}>cwd: {cwd}</Text>
        )}

        <View style={styles.timerRow}>
          <Timer size={12} color={theme.colors.inkTertiary} strokeWidth={2} />
          <Text style={styles.timerText}>Expires in {formatCountdown(remaining)}</Text>
        </View>

        <View style={styles.actions}>
          <Pressable
            onPress={() => onResolve(approvalId, 'deny')}
            style={({ pressed }) => [styles.actionBtn, styles.denyBtn, pressed && styles.denyBtnPressed]}
          >
            <Text style={styles.denyText}>Deny</Text>
          </Pressable>
          <Pressable
            onPress={() => onResolve(approvalId, 'allow-once')}
            style={({ pressed }) => [styles.actionBtn, styles.allowOnceBtn, pressed && styles.allowOnceBtnPressed]}
          >
            <Text style={styles.allowOnceText}>Allow Once</Text>
          </Pressable>
          <Pressable
            onPress={() => onResolve(approvalId, 'allow-always')}
            style={({ pressed }) => [styles.actionBtn, styles.allowAlwaysBtn, pressed && styles.allowAlwaysBtnPressed]}
          >
            <Text style={styles.allowAlwaysText}>Always</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors'], reserveAvatarSlot: boolean) {
  return StyleSheet.create({
    row: {
      width: '100%',
      marginVertical: Space.xs,
      paddingHorizontal: Space.xs,
    },
    card: {
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.warn,
      backgroundColor: colors.surface,
      borderRadius: Radius.card,
      padding: Space.md,
      marginLeft: reserveAvatarSlot ? AGENT_AVATAR_SLOT_WIDTH : 0,
      gap: Space.sm,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
    },
    title: {
      color: colors.ink,
      fontSize: FontSize.secondary,
      fontWeight: FontWeight.semibold,
    },
    commandBlock: {
      backgroundColor: colors.surface,
      borderRadius: Radius.card,
      paddingHorizontal: Space.sm + 2,
      paddingVertical: Space.sm,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
    },
    commandText: {
      color: colors.ink,
      fontSize: FontSize.caption,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
      lineHeight: 17,
    },
    meta: {
      color: colors.inkTertiary,
      fontSize: FontSize.caption,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    },
    timerRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.xs,
    },
    timerText: {
      color: colors.inkTertiary,
      fontSize: FontSize.caption,
    },
    actions: {
      flexDirection: 'row',
      gap: Space.sm,
      marginTop: Space.xs,
    },
    actionBtn: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: Space.sm,
      borderRadius: Radius.full,
      borderWidth: StyleSheet.hairlineWidth,
    },
    denyBtn: {
      borderColor: colors.bad,
      backgroundColor: colors.surface,
    },
    denyBtnPressed: {
      backgroundColor: colors.surface,
    },
    denyText: {
      color: colors.bad,
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
    },
    allowOnceBtn: {
      borderColor: colors.accent,
      backgroundColor: colors.accent,
    },
    allowOnceBtnPressed: {
      opacity: 0.88,
    },
    allowOnceText: {
      color: colors.onAccent,
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
    },
    allowAlwaysBtn: {
      borderColor: colors.good,
      backgroundColor: colors.surface,
    },
    allowAlwaysBtnPressed: {
      backgroundColor: colors.surface,
    },
    allowAlwaysText: {
      color: colors.good,
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
    },
    // Resolved compact state
    resolvedCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm - 2,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.line,
      backgroundColor: colors.surface,
      borderRadius: Radius.card,
      paddingHorizontal: Space.sm + 2,
      paddingVertical: Space.sm,
      marginLeft: reserveAvatarSlot ? AGENT_AVATAR_SLOT_WIDTH : 0,
    },
    resolvedText: {
      fontSize: FontSize.caption,
      fontWeight: FontWeight.semibold,
    },
    resolvedCommand: {
      flex: 1,
      color: colors.inkSecondary,
      fontSize: FontSize.caption,
      fontFamily: Platform.select({ ios: 'Menlo', android: 'monospace' }),
    },
  });
}
