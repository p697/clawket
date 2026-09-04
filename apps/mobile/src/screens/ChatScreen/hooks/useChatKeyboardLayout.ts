import { useCallback, useEffect, useMemo } from 'react';
import { Keyboard, Platform } from 'react-native';
import { EdgeInsets } from 'react-native-safe-area-context';
import { useGenericKeyboardHandler, useKeyboardState } from 'react-native-keyboard-controller';
import { Gesture } from 'react-native-gesture-handler';
import { runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useTabBarHeight } from '../../../hooks/useTabBarHeight';
import { Space } from '../../../theme/tokens';
import { getChatKeyboardBottomPadding } from './chatKeyboardLayout';

type Props = {
  insets: EdgeInsets;
  screenHeight: number;
};

export function useChatKeyboardLayout({ insets, screenHeight }: Props) {
  const tabBarHeight = useTabBarHeight();
  const composerBottomPadding = Space.md;
  const androidKeyboardGap = Space.sm;
  const keyboardHeightSV = useSharedValue(0);
  const composerFocusedSV = useSharedValue(false);

  const handleComposerFocus = useCallback(() => {
    composerFocusedSV.value = true;
  }, [composerFocusedSV]);

  const handleComposerBlur = useCallback(() => {
    composerFocusedSV.value = false;
  }, [composerFocusedSV]);

  useGenericKeyboardHandler({
    onStart: (e) => {
      'worklet';
      keyboardHeightSV.value = e.height;
    },
    onMove: (e) => {
      'worklet';
      keyboardHeightSV.value = e.height;
    },
    onInteractive: (e) => {
      'worklet';
      keyboardHeightSV.value = e.height;
    },
    onEnd: (e) => {
      'worklet';
      keyboardHeightSV.value = e.height;
    },
  }, []);

  const keyboardState = useKeyboardState((state) => ({
    height: state.height,
    isVisible: state.isVisible,
  }));

  useEffect(() => {
    if (__DEV__ && Platform.OS === 'android') {
      console.log('[ChatKeyboardDebug]', {
        reportedHeight: keyboardState.height,
        keyboardVisible: keyboardState.isVisible,
        safeBottomInset: insets.bottom,
      });
    }
  }, [insets.bottom, keyboardState.height, keyboardState.isVisible]);

  const animatedRootStyle = useAnimatedStyle(() => {
    if (composerFocusedSV.value) {
      return {
        // The JS tab navigator already ends the scene above the tab bar.
        // Subtract the physical bar height from keyboard overlap so the
        // composer is lifted exactly once. Android keeps a small IME gap.
        paddingBottom: getChatKeyboardBottomPadding({
          platform: Platform.OS,
          keyboardHeight: keyboardHeightSV.value,
          bottomInset: insets.bottom,
          tabBarHeight,
          androidKeyboardGap,
        }),
      };
    }

    return {
      paddingBottom: withTiming(0, { duration: 250 }),
    };
  });

  const dismissKeyboard = useCallback(() => {
    Keyboard.dismiss();
  }, []);

  const composerSwipeGesture = useMemo(() =>
    Gesture.Pan()
      .activeOffsetY(12)
      .failOffsetY(-5)
      .failOffsetX([-10, 10])
      .onStart(() => {
        runOnJS(dismissKeyboard)();
      }), [dismissKeyboard]);

  const modalBottomInset = insets.bottom;
  const slashSuggestionsMaxHeight = useMemo(
    () => Math.round(Math.min(302, Math.max(182, screenHeight * 0.34 + 2))),
    [screenHeight],
  );

  return {
    animatedRootStyle,
    composerBottomPadding,
    composerSwipeGesture,
    handleComposerBlur,
    handleComposerFocus,
    modalBottomInset,
    slashSuggestionsMaxHeight,
  };
}
