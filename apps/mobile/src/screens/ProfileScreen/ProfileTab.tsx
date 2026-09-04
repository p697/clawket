import React, { useMemo } from 'react';
import { Platform } from 'react-native';
import {
  createNativeStackNavigator,
  type NativeStackHeaderProps,
  type NativeStackNavigationOptions,
} from '@react-navigation/native-stack';
import { NativeStackModalHeader } from '../../hooks/useNativeStackModalHeader';
import { useAppTheme } from '../../theme';
import { YouMindAddOnCreditsScreen } from './YouMindAddOnCreditsScreen';
import { YouMindProfileScreen } from './YouMindProfileScreen';

export type ProfileStackParamList = {
  ProfileHome: undefined;
  AddOnCredits: undefined;
};

const ProfileStack = createNativeStackNavigator<ProfileStackParamList>();
function buildDefaultScreenOptions(contentStyle: {
  backgroundColor: string;
}): NativeStackNavigationOptions {
  return {
    headerShown: false,
    animation: 'slide_from_right',
    gestureEnabled: true,
    fullScreenGestureEnabled: true,
    contentStyle,
    header: (props: NativeStackHeaderProps) => <NativeStackModalHeader {...props} />,
    headerBackTitle: '',
    headerBackButtonDisplayMode: 'minimal',
  };
}

function buildNativeModalScreenOptions(contentStyle: {
  backgroundColor: string;
}): NativeStackNavigationOptions {
  if (Platform.OS !== 'ios') {
    return {
      headerShown: true,
      animation: 'slide_from_right',
      contentStyle,
      header: (props: NativeStackHeaderProps) => (
        <NativeStackModalHeader {...props} dismissStyleOverride="close" />
      ),
    };
  }

  return {
    headerShown: true,
    animation: 'slide_from_bottom',
    presentation: 'modal',
    gestureEnabled: true,
    contentStyle,
    header: (props: NativeStackHeaderProps) => (
      <NativeStackModalHeader {...props} dismissStyleOverride="close" />
    ),
  };
}

export function ProfileTab(): React.JSX.Element {
  const { theme } = useAppTheme();
  const defaultContentStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.background,
    }),
    [theme.colors.background],
  );
  const modalContentStyle = useMemo(
    () => ({
      backgroundColor: theme.colors.background,
    }),
    [theme.colors.background],
  );
  const defaultScreenOptions = useMemo(
    () => buildDefaultScreenOptions(defaultContentStyle),
    [defaultContentStyle],
  );
  const nativeModalScreenOptions = useMemo(
    () => buildNativeModalScreenOptions(modalContentStyle),
    [modalContentStyle],
  );

  return (
    <ProfileStack.Navigator screenOptions={defaultScreenOptions}>
      <ProfileStack.Screen name="ProfileHome" component={YouMindProfileScreen} />
      <ProfileStack.Screen
        name="AddOnCredits"
        component={YouMindAddOnCreditsScreen}
        options={nativeModalScreenOptions}
      />
    </ProfileStack.Navigator>
  );
}
