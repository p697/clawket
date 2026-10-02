import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react-native';
import { ChevronRight } from '../ui/DirectionalIcon';
import { FontSize, LineHeight, Motion, Space } from '../../theme/tokens';
import { useChatSurfaces } from './ChatPresentation';
import { formatTurnReceipt } from './tool-activity-model';
import type { TurnReceipt } from './turn-work';

const CHIP_HEIGHT = 24;
const GLYPH = 13;
const CHEVRON = 12;

/**
 * A finished turn's receipt (tool process design C, owner decision
 * 2026-10-02): one small chip at the foot of the Agent's last reply, beside
 * its time, like a Telegram reaction — "Edited a file · 6 steps · 2 min 40 s".
 * It opens the turn's work record.
 */
export function TurnReceiptChip({ receipt, onPress, testID }: Readonly<{
  receipt: TurnReceipt;
  onPress?: (receipt: TurnReceipt) => void;
  testID?: string;
}>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const surfaces = useChatSurfaces();
  const color = surfaces.incoming.metaColor;
  const label = formatTurnReceipt(receipt.steps, t);
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('Work record: {{summary}}', { summary: label })}
      disabled={!onPress}
      onPress={() => onPress?.(receipt)}
      hitSlop={{ top: Space.sm, bottom: Space.sm }}
      style={({ pressed }) => [styles.chip, { backgroundColor: surfaces.well }, pressed ? styles.pressed : null]}
    >
      <Layers size={GLYPH} color={color} strokeWidth={2} />
      <Text numberOfLines={1} style={[styles.label, { color }]}>{label}</Text>
      <ChevronRight size={CHEVRON} color={color} strokeWidth={2} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    flexShrink: 1,
    minWidth: 0,
    height: CHIP_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    paddingLeft: Space.sm - 1,
    paddingRight: Space.sm - 2,
    borderRadius: CHIP_HEIGHT / 2,
  },
  label: {
    flexShrink: 1,
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
  },
  pressed: {
    opacity: Motion.pressedOpacity,
  },
});
