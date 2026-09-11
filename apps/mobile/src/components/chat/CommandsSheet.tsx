import React, { useCallback, useMemo, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { BottomSheetFlatList } from '@gorhom/bottom-sheet';
import { useTranslation } from 'react-i18next';
import type { SlashCommand } from '../../data/slash-commands';
import { ControlSize, Space } from '../../theme/tokens';
import { ConfirmationModal } from '../ui/ConfirmationModal';
import { SettingsDivider, SettingsRow } from '../ui/SettingsGroup';
import { Sheet } from '../ui/Sheet';
import { triggerSelectionHaptic } from '../../services/haptics';
import { CONFIRMED_SLASH_COMMAND_KEYS, useSlashCommandDescriptions } from './slashCommandCopy';

export type CommandsSheetProps = Readonly<{
  visible: boolean;
  commands: readonly SlashCommand[];
  onClose: () => void;
  /** Runs after the sheet has finished closing (and after confirmation for destructive commands). */
  onSelect: (command: SlashCommand) => void;
}>;

const SNAP_POINTS: string[] = ['68%', '92%'];

/**
 * Full slash-command catalog opened from the Add sheet. The typed `/`
 * autocomplete above the composer stays separate; this is a browsable menu
 * with the canonical sheet chrome, so it closes like every other sheet.
 */
export function CommandsSheet({ visible, commands, onClose, onSelect }: CommandsSheetProps): React.JSX.Element {
  const { t } = useTranslation(['chat', 'common']);
  const describe = useSlashCommandDescriptions();
  const styles = useMemo(() => createStyles(), []);
  const pendingRef = useRef<SlashCommand | null>(null);
  const [confirming, setConfirming] = useState<SlashCommand | null>(null);

  const choose = useCallback((command: SlashCommand) => {
    if (pendingRef.current) return;
    triggerSelectionHaptic();
    pendingRef.current = command;
    onClose();
  }, [onClose]);

  const afterClose = useCallback(() => {
    const command = pendingRef.current;
    pendingRef.current = null;
    if (!command) return;
    if (CONFIRMED_SLASH_COMMAND_KEYS.has(command.key)) {
      setConfirming(command);
      return;
    }
    onSelect(command);
  }, [onSelect]);

  const confirm = useCallback(() => {
    const command = confirming;
    setConfirming(null);
    if (command) onSelect(command);
  }, [confirming, onSelect]);

  return (
    <>
      <Sheet
        visible={visible}
        onClose={onClose}
        onAfterClose={afterClose}
        closeAccessibilityLabel={t('Close', { ns: 'common' })}
        title={t('Commands')}
        snapPoints={SNAP_POINTS}
        testID="commands-sheet"
      >
        <BottomSheetFlatList
          data={commands as SlashCommand[]}
          keyExtractor={(item: SlashCommand) => item.key}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          ItemSeparatorComponent={() => <SettingsDivider inset="none" />}
          renderItem={({ item }: { item: SlashCommand }) => (
            <SettingsRow
              testID={`commands-sheet-${item.key}`}
              title={describe(item)}
              value={item.command}
              onPress={() => choose(item)}
              style={styles.row}
            />
          )}
        />
      </Sheet>
      <ConfirmationModal
        testID="commands-sheet-confirm"
        visible={confirming !== null}
        title={confirming ? describe(confirming) : ''}
        message={t('Send {{command}} to the Agent?', { command: confirming?.command ?? '' })}
        cancelLabel={t('Cancel', { ns: 'common' })}
        confirmLabel={t('Send')}
        destructive
        onClose={() => setConfirming(null)}
        onConfirm={confirm}
      />
    </>
  );
}

function createStyles() {
  return StyleSheet.create({
    content: {
      paddingHorizontal: Space.lg,
      paddingTop: Space.xs,
      paddingBottom: Space.xxl,
    },
    row: {
      minHeight: ControlSize.settingsRow,
      paddingHorizontal: 0,
    },
  });
}
