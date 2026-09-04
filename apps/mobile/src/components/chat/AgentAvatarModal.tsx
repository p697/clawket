import React, { useMemo } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { Camera, Trash2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { Button, ModalSheet, ThemedSwitch } from '../ui';
import { useAppTheme } from '../../theme';
import { useAppContext } from '../../contexts/AppContext';
import { FontSize, FontWeight, Radius, Space } from '../../theme/tokens';
import { extractDisplayAgentEmoji } from '../../utils/agent-emoji';

type Props = {
  visible: boolean;
  agentName: string;
  agentEmoji?: string;
  avatarUri?: string;
  onPickImage: () => void;
  onRemove: () => void;
  onClose: () => void;
};

export function AgentAvatarModal({ visible, agentName, agentEmoji, avatarUri, onPickImage, onRemove, onClose }: Props): React.JSX.Element {
  const { t } = useTranslation('chat');
  const { t: tConfig } = useTranslation('config');
  const { theme } = useAppTheme();
  const { showAgentAvatar, onShowAgentAvatarToggle } = useAppContext();
  const styles = useMemo(() => createStyles(theme.colors), [theme]);
  const { colors } = theme;
  const displayEmoji = extractDisplayAgentEmoji(agentEmoji);
  const normalizedAvatarUri = avatarUri?.trim();

  return (
    <ModalSheet visible={visible} onClose={onClose} title={t('Agent Avatar')}>
      <View style={styles.body}>
        {/* Current avatar */}
        <View style={styles.avatarSection}>
          {normalizedAvatarUri ? (
            <Image source={{ uri: normalizedAvatarUri }} style={styles.avatarLarge} />
          ) : (
            <View style={[styles.avatarLarge, styles.avatarPlaceholder, { backgroundColor: colors.primarySoft }]}>
              <Text style={styles.avatarPlaceholderText}>
                {displayEmoji || (agentName || 'A').charAt(0).toUpperCase()}
              </Text>
            </View>
          )}
          <Text style={styles.agentName}>{agentName}</Text>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          <Button label={t('Pick a Photo')} icon={Camera} variant="secondary" onPress={onPickImage} />
          {normalizedAvatarUri && (
            <Button label={t('common:Remove')} icon={Trash2} variant="destructive" onPress={onRemove} />
          )}
        </View>

        {/* Show avatar toggle */}
        <View style={styles.toggleRow}>
          <Text style={[styles.toggleLabel, { color: colors.text }]}>{tConfig('Show Agent Avatar')}</Text>
          <ThemedSwitch
            value={showAgentAvatar}
            onValueChange={onShowAgentAvatarToggle}
          />
        </View>
      </View>
    </ModalSheet>
  );
}

function createStyles(colors: ReturnType<typeof useAppTheme>['theme']['colors']) {
  return StyleSheet.create({
    body: {
      padding: Space.lg,
    },
    avatarSection: {
      alignItems: 'center',
      marginBottom: Space.lg,
    },
    avatarLarge: {
      width: 80,
      height: 80,
      borderRadius: Radius.full,
    },
    avatarPlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarPlaceholderText: {
      fontSize: FontSize.displayHero,
    },
    agentName: {
      marginTop: Space.sm,
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
      color: colors.text,
    },
    actions: {
      gap: Space.sm,
    },
    toggleRow: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginTop: Space.lg,
      paddingHorizontal: Space.md,
      paddingBottom: Space.sm,
    },
    toggleLabel: {
      fontSize: FontSize.base,
      fontWeight: FontWeight.semibold,
    },
  });
}
