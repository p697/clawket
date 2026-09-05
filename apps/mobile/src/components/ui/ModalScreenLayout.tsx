import React, { useMemo } from 'react';
import { StyleSheet, View, ViewStyle } from 'react-native';
import { useAppTheme } from '../../theme';
import { ScreenHeader } from './ScreenHeader';

type Props = {
  title: string;
  topInset: number;
  onClose: () => void;
  subtitle?: string;
  rightContent?: React.ReactNode;
  children: React.ReactNode;
  style?: ViewStyle;
  contentStyle?: ViewStyle;
};

export function ModalScreenLayout({
  title,
  topInset,
  onClose,
  subtitle,
  rightContent,
  children,
  style,
  contentStyle,
}: Props): React.JSX.Element {
  const { theme } = useAppTheme();
  const styles = useMemo(() => createStyles(theme.colors.canvas), [theme.colors.canvas]);

  return (
    <View style={[styles.root, style]}>
      <ScreenHeader
        title={title}
        topInset={topInset}
        onBack={onClose}
        dismissStyle="close"
        subtitle={subtitle}
        topInsetBehavior="compact"
        rightContent={rightContent}
      />
      <View style={[styles.content, contentStyle]}>{children}</View>
    </View>
  );
}

function createStyles(backgroundColor: string) {
  return StyleSheet.create({
    root: {
      flex: 1,
      backgroundColor,
    },
    content: {
      flex: 1,
    },
  });
}
