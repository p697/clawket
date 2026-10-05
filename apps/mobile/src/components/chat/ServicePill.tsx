import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FontSize, FontWeight, LineHeight, Radius, Space } from '../../theme/tokens';
import { useChatSurfaces } from './ChatPresentation';

export type ServicePillProps = Readonly<{
  label: string;
  /** Semibold, for date labels. */
  emphasis?: boolean;
  numberOfLines?: number;
  testID?: string;
}>;

/**
 * A centred translucent pill over the conversation, Telegram style: dates and
 * system notices (A+ chat design, owner decision 2026-09-30). It never
 * competes with the bubbles. Tool activity never takes this form (owner
 * decision 2026-10-05): it lives in the work dock and the turn receipts.
 */
export function ServicePill({ label, emphasis = false, numberOfLines = 1, testID }: ServicePillProps): React.JSX.Element {
  const { service } = useChatSurfaces();
  return (
    <View testID={testID} style={[styles.pill, { backgroundColor: service.backgroundColor }]}>
      <Text
        style={[styles.label, { color: service.textColor }, emphasis ? styles.emphasis : null]}
        numberOfLines={numberOfLines}
      >
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  pill: {
    alignSelf: 'center',
    maxWidth: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: Space.xs,
    borderRadius: Radius.full,
    paddingVertical: Space.xs - 1,
    paddingHorizontal: Space.sm + 2,
  },
  label: {
    flexShrink: 1,
    fontSize: FontSize.caption,
    lineHeight: LineHeight.caption,
    fontWeight: FontWeight.regular,
    textAlign: 'center',
  },
  emphasis: {
    fontWeight: FontWeight.semibold,
  },
});
