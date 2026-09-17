import React, { useMemo } from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { BottomSheetBackdrop } from '@gorhom/bottom-sheet';
import { useAppTheme } from '../../theme';

type SheetBackdropProps = React.ComponentProps<typeof BottomSheetBackdrop> & {
  testID?: string;
  dismissOnPress?: boolean;
  onBackdropPress?: () => void;
};

/** Standard 40% scrim and explicit press target for app-owned sheets. */
export function SheetBackdrop({
  testID,
  dismissOnPress = true,
  onBackdropPress,
  style,
  ...props
}: SheetBackdropProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const backdropStyle = useMemo(
    () => ({ backgroundColor: theme.colors.scrim }),
    [theme.colors.scrim],
  );

  return (
    <BottomSheetBackdrop
      {...props}
      appearsOnIndex={0}
      disappearsOnIndex={-1}
      opacity={1}
      pressBehavior="none"
      style={[style, backdropStyle]}
      accessible={false}
    >
      <Pressable testID={testID} accessible={false} disabled={!dismissOnPress}
        onPress={dismissOnPress ? onBackdropPress : undefined} style={StyleSheet.absoluteFill} />
    </BottomSheetBackdrop>
  );
}
