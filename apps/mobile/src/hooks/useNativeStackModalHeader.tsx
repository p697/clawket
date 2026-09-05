import React, { useLayoutEffect } from 'react';
import { Platform } from 'react-native';
import {
  type NativeStackHeaderProps,
  type NativeStackNavigationOptions,
  type NativeStackNavigationProp,
} from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '../components/ui';
import { useAppTheme } from '../theme';

type HeaderTopInsetBehavior = 'auto' | 'safe' | 'compact' | 'none';

type Props = {
  navigation: NativeStackNavigationProp<any>;
  title?: string;
  rightContent?: React.ReactNode;
  onClose?: () => void;
  headerBackgroundColor?: string;
  headerTransparent?: boolean;
  topInsetBehavior?: HeaderTopInsetBehavior;
  dismissStyle?: 'back' | 'close';
  showBorder?: boolean;
};

type AppStackHeaderProps = NativeStackHeaderProps & {
  titleOverride?: string;
  rightContentOverride?: React.ReactNode;
  onCloseOverride?: () => void;
  headerBackgroundColorOverride?: string;
  headerTransparentOverride?: boolean;
  dismissStyleOverride?: 'back' | 'close';
  topInsetBehaviorOverride?: HeaderTopInsetBehavior;
  showBorderOverride?: boolean;
};

const SHEET_PRESENTATIONS: ReadonlyArray<string | undefined> = [
  'modal',
  'formSheet',
  'pageSheet',
];

const CLOSE_PRESENTATIONS: ReadonlyArray<string | undefined> = [
  ...SHEET_PRESENTATIONS,
  'fullScreenModal',
  'transparentModal',
];

function resolveHeaderTitle(options: NativeStackHeaderProps['options'], titleOverride?: string): string {
  if (titleOverride !== undefined) return titleOverride;
  if (typeof options.headerTitle === 'string') return options.headerTitle;
  if (typeof options.title === 'string') return options.title;
  return '';
}

/**
 * App-owned native-stack header. React Navigation still owns transitions and
 * gestures, while every visible header surface and action is rendered through
 * Clawket components instead of iOS system navigation-button chrome.
 */
export function NativeStackModalHeader({
  navigation,
  route,
  options,
  back,
  titleOverride,
  rightContentOverride,
  onCloseOverride,
  headerBackgroundColorOverride,
  headerTransparentOverride,
  dismissStyleOverride,
  topInsetBehaviorOverride,
  showBorderOverride,
}: AppStackHeaderProps): React.JSX.Element {
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const resolvedTitle = resolveHeaderTitle(options, titleOverride);
  const title = titleOverride !== undefined ? resolvedTitle : (resolvedTitle || route.name);
  const headerTransparent = headerTransparentOverride ?? options.headerTransparent ?? false;
  const backgroundColor = headerTransparent
    ? 'transparent'
    : headerBackgroundColorOverride ?? theme.colors.canvas;
  const isIOSSheetPresentation = Platform.OS === 'ios'
    && SHEET_PRESENTATIONS.includes(options.presentation);
  const topInsetBehavior = topInsetBehaviorOverride
    ?? (!headerTransparent && isIOSSheetPresentation ? 'compact' : 'safe');
  const dismissStyle = dismissStyleOverride
    ?? (CLOSE_PRESENTATIONS.includes(options.presentation) ? 'close' : 'back');
  const leftContent = options.headerLeft
    ? options.headerLeft({
        tintColor: theme.colors.inkSecondary,
        canGoBack: !!back,
      })
    : undefined;
  const rightContent = rightContentOverride !== undefined
    ? rightContentOverride
    : options.headerRight?.({
        tintColor: theme.colors.inkSecondary,
        canGoBack: !!back,
      });

  return (
    <ScreenHeader
      title={title}
      topInset={insets.top}
      onBack={leftContent ? undefined : (onCloseOverride ?? (() => navigation.goBack()))}
      dismissStyle={dismissStyle}
      topInsetBehavior={topInsetBehavior}
      leftContent={leftContent}
      rightContent={rightContent}
      showBorder={showBorderOverride}
      style={{ backgroundColor }}
    />
  );
}

export function useNativeStackModalHeader({
  navigation,
  title,
  rightContent,
  onClose,
  headerBackgroundColor,
  headerTransparent = false,
  topInsetBehavior,
  dismissStyle = 'close',
  showBorder,
}: Props): void {
  const { theme } = useAppTheme();
  const resolvedHeaderBackground = headerBackgroundColor ?? theme.colors.canvas;

  useLayoutEffect(() => {
    const options: NativeStackNavigationOptions = {
      headerShown: true,
      headerBackVisible: false,
      headerShadowVisible: false,
      headerTitle: title ?? '',
      headerTitleAlign: 'center',
      headerTransparent,
      header: (props) => (
        <NativeStackModalHeader
          {...props}
          titleOverride={title ?? ''}
          rightContentOverride={rightContent}
          onCloseOverride={onClose}
          headerBackgroundColorOverride={resolvedHeaderBackground}
          headerTransparentOverride={headerTransparent}
          dismissStyleOverride={dismissStyle}
          topInsetBehaviorOverride={topInsetBehavior}
          showBorderOverride={showBorder}
        />
      ),
    };

    navigation.setOptions(options);
  }, [
    dismissStyle,
    headerTransparent,
    navigation,
    onClose,
    resolvedHeaderBackground,
    rightContent,
    showBorder,
    title,
    topInsetBehavior,
  ]);
}
