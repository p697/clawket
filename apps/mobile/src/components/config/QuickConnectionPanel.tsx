import React, { useMemo } from 'react';
import { StyleProp, StyleSheet, Text, View, ViewStyle } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Cloud, Link2 } from 'lucide-react-native';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { Button, Card } from '../ui';

type QuickConnectionTarget = 'local' | 'youmind';

type QuickConnectionCard = {
  key: QuickConnectionTarget;
  icon: React.ReactNode;
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
      icon: <Link2 size={18} color={theme.colors.primary} strokeWidth={2.1} />,
      title: t('Local Agents'),
      description: t('Run the Clawket pairing command on your computer, then enter the code it shows.'),
      badges: [t('OpenClaw'), t('Hermes')],
    },
    {
      key: 'youmind',
      icon: <Cloud size={18} color={theme.colors.primary} strokeWidth={2.1} />,
      title: t('Cloud Agents'),
      description: t('Sign in directly on this device. No computer setup required.'),
      badges: [t('YouMind')],
    },
  ], [t, theme.colors.primary]);

  return (
    <View style={style}>
      <Text style={styles.quickHint}>{t('Choose how you want to connect.')}</Text>

      {cards.map((card) => (
        <Card key={card.key} style={styles.quickGroupCard} padding="lg">
          <View style={styles.quickGroupHeader}>
            <View style={styles.quickGroupIcon}>
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

          <Button
            label={t('Start Connection')}
            icon={card.key === 'local' ? Link2 : Cloud}
            onPress={() => onSelectTarget(card.key)}
            style={styles.quickAction}
          />
        </Card>
      ))}
    </View>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    quickHint: {
      fontSize: FontSize.md,
      color: colors.textMuted,
      lineHeight: 20,
      marginBottom: Space.lg,
      textAlign: 'center',
    },
    quickGroupCard: {
      borderRadius: Radius.lg,
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
      width: ControlSize.compact,
      height: ControlSize.compact,
      borderRadius: Radius.full,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.primarySoft,
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
      marginTop: 0,
      marginBottom: Space.sm,
    },
  });
}
