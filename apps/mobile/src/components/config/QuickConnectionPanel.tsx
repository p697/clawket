import React, { useMemo } from 'react';
import { Pressable, StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Cloud, Link2, Radar, Share2, Bluetooth, Wifi } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { FontSize, FontWeight, Radius, Shadow, Space } from '../../theme/tokens';
import { PairingTransportLottie } from './PairingTransportLottie';
import { PAIRING_TRANSPORT_OPTIONS } from './pairingTransportOptions';

export type QuickConnectionTarget =
  | 'local'
  | 'youmind'
  | 'tailscale'
  | 'bonjour'
  | 'multipeer'
  | 'airdrop';

type QuickConnectionCard = {
  key: QuickConnectionTarget;
  icon: React.ReactNode;
  iconBackgroundColor: string;
  title: string;
  description: string;
  badges: string[];
};

type Props = {
  onSelectTarget: (target: QuickConnectionTarget) => void;
  style?: StyleProp<ViewStyle>;
};

export function QuickConnectionPanel({ onSelectTarget, style }: Props): React.JSX.Element {
  const { t } = useTranslation('config');
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors), [theme.colors]);
  const cards = useMemo<QuickConnectionCard[]>(() => [
    {
      key: 'local',
      icon: <Link2 size={18} color="#2F6BFF" strokeWidth={2.1} />,
      iconBackgroundColor: '#E7F0FF',
      title: t('Local Agents'),
      description: t('Install the Clawket CLI on your computer, then pair with a QR code.'),
      badges: [t('OpenClaw'), t('Hermes')],
    },
    {
      key: 'youmind',
      icon: <Cloud size={18} color="#39834A" strokeWidth={2.1} />,
      iconBackgroundColor: '#EEF8E8',
      title: t('Cloud Agents'),
      description: t('Sign in directly on this device. No computer setup required.'),
      badges: [t('YouMind')],
    },
  ], [t]);

  const transportCards = useMemo(() => (
    PAIRING_TRANSPORT_OPTIONS.filter((item) => !['relay', 'local'].includes(item.id))
  ), []);

  return (
    <View style={style}>
      <Text style={styles.quickHint}>{t('Choose how you want to connect.')}</Text>

      {cards.map((card) => (
        <View key={card.key} style={styles.quickGroupCard}>
          <View style={styles.quickGroupHeader}>
            <View style={[styles.quickGroupIcon, { backgroundColor: card.iconBackgroundColor }]}>
              {card.icon}
            </View>
            <View style={styles.quickGroupHeaderText}>
              <Text style={styles.quickGroupTitle}>{card.title}</Text>
              <Text style={styles.quickGroupSubtitle}>{card.description}</Text>
            </View>
          </View>

          <View style={styles.quickBadgeRow}>
            {card.badges.map((badge) => (
              <View key={badge} style={styles.quickBadge}>
                <Text style={styles.quickBadgeText}>{badge}</Text>
              </View>
            ))}
          </View>

          {card.key === 'local' ? (
            <View style={styles.transportGrid}>
              <Text style={styles.transportHeading}>{t('Pairing methods')}</Text>
              {transportCards.map((item) => (
                <Pressable
                  key={item.id}
                  onPress={() => onSelectTarget(item.id as QuickConnectionTarget)}
                  style={({ pressed }) => [styles.transportCard, pressed && styles.transportCardPressed]}
                >
                  <PairingTransportLottie source={item.lottie} size={56} />
                  <View style={styles.transportTextCol}>
                    <View style={styles.transportTitleRow}>
                      {item.id === 'tailscale' ? <Wifi size={14} color={theme.colors.primary} /> : null}
                      {item.id === 'bonjour' ? <Radar size={14} color={theme.colors.primary} /> : null}
                      {item.id === 'multipeer' ? <Bluetooth size={14} color={theme.colors.primary} /> : null}
                      {item.id === 'airdrop' ? <Share2 size={14} color={theme.colors.primary} /> : null}
                      <Text style={styles.transportTitle}>{item.label}</Text>
                    </View>
                    <Text style={styles.transportSubtitle} numberOfLines={2}>{item.description}</Text>
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}

          <Pressable
            onPress={() => onSelectTarget(card.key)}
            style={({ pressed }) => [styles.primaryButton, styles.quickAction, pressed && styles.primaryButtonPressed]}
          >
            <View style={styles.buttonContent}>
              {card.key === 'local'
                ? <Link2 size={15} color={theme.colors.primaryText} strokeWidth={2} />
                : <Cloud size={15} color={theme.colors.primaryText} strokeWidth={2} />
              }
              <Text style={styles.primaryButtonText}>
                {card.key === 'local' ? t('Start with QR / guide') : t('Start Connection')}
              </Text>
            </View>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    buttonContent: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: Space.sm,
    },
    primaryButton: {
      alignItems: 'center',
      backgroundColor: colors.primary,
      borderRadius: Radius.md,
      paddingVertical: 11,
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
    quickHint: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 20,
      marginBottom: Space.lg,
      textAlign: 'center',
    },
    quickGroupCard: {
      backgroundColor: colors.surface,
      borderRadius: Radius.lg,
      borderWidth: 1,
      borderColor: colors.border,
      padding: Space.lg,
      marginBottom: Space.md,
    },
    quickGroupHeader: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: Space.sm,
    },
    quickGroupHeaderText: {
      flex: 1,
      gap: Space.xs,
    },
    quickGroupIcon: {
      width: 36,
      height: 36,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
    },
    quickGroupTitle: {
      color: colors.text,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
    quickGroupSubtitle: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      lineHeight: 18,
    },
    quickBadgeRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: Space.xs,
      marginTop: Space.md,
      marginBottom: Space.sm,
    },
    quickBadge: {
      backgroundColor: colors.surfaceMuted,
      borderRadius: Radius.full,
      paddingHorizontal: Space.sm,
      paddingVertical: 6,
    },
    quickBadgeText: {
      color: colors.text,
      fontSize: FontSize.xs,
      fontWeight: FontWeight.semibold,
    },
    quickAction: {
      marginTop: Space.sm,
      marginBottom: 0,
    },
    transportGrid: {
      gap: Space.sm,
      marginBottom: Space.sm,
    },
    transportHeading: {
      color: colors.textMuted,
      fontSize: FontSize.sm,
      fontWeight: FontWeight.semibold,
      marginTop: Space.xs,
    },
    transportCard: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: Space.sm,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: Radius.md,
      padding: Space.sm,
      backgroundColor: colors.surfaceMuted,
    },
    transportCardPressed: {
      opacity: 0.88,
    },
    transportTextCol: {
      flex: 1,
      gap: 2,
    },
    transportTitleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    transportTitle: {
      color: colors.text,
      fontSize: FontSize.md,
      fontWeight: FontWeight.semibold,
    },
    transportSubtitle: {
      color: colors.textMuted,
      fontSize: FontSize.xs,
      lineHeight: 16,
    },
  });
}
