import React from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import { useTranslation } from 'react-i18next';
import { CircleAlert, Layers } from 'lucide-react-native';
import { ChevronRight } from '../ui/DirectionalIcon';
import { FontSize, LineHeight, Motion, Space } from '../../theme/tokens';
import { formatToolDisplayName, resolveToolTitle } from '../../utils/tool-display';
import { useChatSurfaces, useConversationTheme } from './ChatPresentation';
import { describeFailedStep, effectiveTool, formatTurnReceipt } from './tool-activity-model';
import type { TurnReceipt } from './turn-work';

const CHIP_HEIGHT = 24;
const GLYPH = 13;
const CHEVRON = 12;
// `monospace` is a family only Android resolves; iOS falls back to the system face without Menlo.
const CODE_FONT = Platform.select({ ios: 'Menlo', default: 'monospace' });

/**
 * A finished turn's receipt (tool process design C, owner decision
 * 2026-10-02): one small chip at the foot of the Agent's last reply, beside
 * its time, like a Telegram reaction — "Edited a file · 6 steps · 2 min 40 s".
 * A turn that ended on a failed step reads red — a red glyph on a soft red
 * fill — and names that step ("`npm test` failed") in the bubble's own text
 * color, which keeps 4.5:1 where red text on red would not. It opens the
 * turn's work record.
 */
export function TurnReceiptChip({ receipt, onPress, testID }: Readonly<{
  receipt: TurnReceipt;
  onPress?: (receipt: TurnReceipt) => void;
  testID?: string;
}>): React.JSX.Element {
  const { t } = useTranslation('chat');
  const surfaces = useChatSurfaces();
  const { colors } = useConversationTheme();
  const last = receipt.failed ? receipt.steps[receipt.steps.length - 1] : undefined;
  const tool = last ? effectiveTool(last) : undefined;
  const failure = last && tool
    ? describeFailedStep(last, resolveToolTitle(tool.args) ?? formatToolDisplayName(tool.name || t('Tool'), t), t)
    : undefined;
  const label = failure ? `${failure.before}${failure.value}${failure.after}` : formatTurnReceipt(receipt.steps, t);
  const color = failure ? surfaces.incoming.textColor : surfaces.incoming.metaColor;
  const Glyph = failure ? CircleAlert : Layers;
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={t('Work record: {{summary}}', { summary: label })}
      disabled={!onPress}
      onPress={() => onPress?.(receipt)}
      hitSlop={{ top: Space.sm, bottom: Space.sm }}
      style={({ pressed }) => [styles.chip, { backgroundColor: failure ? colors.badSoft : surfaces.well }, pressed ? styles.pressed : null]}
    >
      <Glyph testID={testID ? `${testID}-glyph` : undefined} size={GLYPH} color={failure ? colors.bad : color} strokeWidth={2} />
      <Text numberOfLines={1} style={[styles.label, { color }]}>
        {failure ? <>
          {failure.before}
          <Text style={failure.code ? styles.code : undefined}>{failure.value}</Text>
          {failure.after}
        </> : label}
      </Text>
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
  code: {
    fontFamily: CODE_FONT,
    fontSize: FontSize.meta,
  },
  pressed: {
    opacity: Motion.pressedOpacity,
  },
});
