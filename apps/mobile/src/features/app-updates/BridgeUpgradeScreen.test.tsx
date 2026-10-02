import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import * as Clipboard from 'expo-clipboard';
import { BridgeUpgradeScreen } from './BridgeUpgradeScreen';
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: any) => ReactRuntime.createElement(name, props, children);
  return { Platform: { OS: 'ios', select: (value: any) => value.ios ?? value.default }, View: host('View'), Text: host('Text'), Pressable: host('Pressable'), ScrollView: host('ScrollView'), Share: { share: jest.fn() }, StyleSheet: { create: (styles: any) => styles } };
});
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn().mockResolvedValue(undefined) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ bottom: 0 }) }));
let mockScheme = 'light';
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { scheme: mockScheme, colors: { canvasGrouped: 'white', inkSecondary: 'gray' } } }) }));
jest.mock('../../screens/AccountSettings/AccountSettingsPageHeader', () => ({ AccountSettingsPageHeader: () => null }));
jest.mock('../../components/ui/SettingsGroup', () => {
  const { View, Text } = require('react-native');
  return { SettingsGroup: ({ children }: any) => <View>{children}</View>, SettingsDivider: () => null, SettingsRow: ({ title, value, subtitle }: any) => <View><Text>{title}</Text><Text>{value}</Text><Text>{subtitle}</Text></View> };
});
jest.mock('../../components/ui/SetupPrimitives', () => {
  const { View, Text, Pressable } = require('react-native');
  return { PageIntro: ({ title }: any) => <Text>{title}</Text>, FormStep: ({ children }: any) => <View>{children}</View>, CommandBlock: ({ command, onCopy, copyTestID }: any) => <Pressable testID={copyTestID} onPress={onCopy}><Text>{command}</Text></Pressable> };
});
jest.mock('../../components/ui/Button', () => {
  const { Text, Pressable } = require('react-native'); return { Button: ({ label, onPress, testID }: any) => <Pressable testID={testID} onPress={onPress}><Text>{label}</Text></Pressable> };
});
const props = { onBack: jest.fn(), connections: [{ id: 'a', backendKind: 'codex' as const, transportKind: 'relay' as const, label: 'Computer', createdAt: 1, isFreeSlot: true }], versions: { a: '3.1.10' }, release: { version: '3.1.11', unifiedUpdate: true, checkedAt: 1 }, checking: false, failed: false, onCheck: jest.fn(), readyId: 'a' };
it.each(['light', 'dark'])('shows actual version and copying never reports a completed upgrade (%s)', async nextScheme => {
  mockScheme = nextScheme; const view = render(<BridgeUpgradeScreen {...props} />);
  expect(view.getByText('3.1.10')).toBeTruthy(); expect(view.getByText(/Bridge update available/)).toBeTruthy();
  await act(async () => { fireEvent.press(view.getByTestId('bridge-upgrade-copy')); });
  expect(Clipboard.setStringAsync).toHaveBeenCalledWith('npx -y @p697/clawket@3.1.11 update'); expect(view.getByText(/Bridge update available/)).toBeTruthy();
  view.rerender(<BridgeUpgradeScreen {...props} versions={{ a: '3.1.11' }} />); expect(view.queryByText(/Bridge update available/)).toBeNull(); expect(view.getByText('Current Bridge version')).toBeTruthy();
});
it('does not offer an unreleased updater or mislabel cached offline evidence as current', () => {
  const view = render(<BridgeUpgradeScreen {...props} readyId={null} release={{ ...props.release, unifiedUpdate: false }} />); expect(view.queryByTestId('bridge-upgrade-copy')).toBeNull();
  view.rerender(<BridgeUpgradeScreen {...props} readyId={null} release={null} />); expect(view.getByText('Last confirmed Bridge version')).toBeTruthy();
});
