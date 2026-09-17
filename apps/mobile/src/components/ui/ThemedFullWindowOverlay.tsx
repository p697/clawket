import React, { useContext } from 'react';
import { Platform, StyleSheet, View } from 'react-native';
import { FullWindowOverlay } from 'react-native-screens';
import { ThemeContext } from '../../theme';

/** Keeps the current app theme available inside the detached iOS window. */
export function ThemedFullWindowOverlay({
  children,
}: React.PropsWithChildren): React.JSX.Element {
  const themeValue = useContext(ThemeContext);
  if (Platform.OS !== 'ios') {
    return <>{children}</>;
  }

  return (
    <FullWindowOverlay>
      <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
        <ThemeContext.Provider value={themeValue}>
          {children}
        </ThemeContext.Provider>
      </View>
    </FullWindowOverlay>
  );
}
