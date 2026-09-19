import React, { useEffect, useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Pressable, Text, View } from 'react-native';
import { AdaptiveWorkspace } from './AdaptiveWorkspace';
import { useWorkspaceLayout } from './workspace-context';

let mockWidth = 1194;
let mockTablet = true;
jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return { View: host('View'), Text: host('Text'), Pressable: host('Pressable'),
    StyleSheet: { create: (s: unknown) => s, absoluteFill: { position: 'absolute' }, flatten: (s: unknown) => s },
    useWindowDimensions: () => ({ width: mockWidth, height: 834, fontScale: 1 }) };
});
jest.mock('../utils/platform', () => ({ get isIPad() { return mockTablet; } }));
jest.mock('../theme', () => ({ useAppTheme: () => ({ theme: { colors: { canvas: 'white', scrim: 'black' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ left: 0, right: 0 }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (s: string) => s }) }));

const mounted = jest.fn();
const unmounted = jest.fn();
function Conversation() {
  const { toggleRoster, paneWidth } = useWorkspaceLayout();
  const [draft, setDraft] = useState('');
  useEffect(() => { mounted(); return unmounted; }, []);
  return <View><Text testID="pane-width">{paneWidth}</Text><Text testID="draft">{draft}</Text>
    <Pressable testID="type" onPress={() => setDraft('中文草稿')} />
    <Pressable testID="toggle" onPress={toggleRoster} /></View>;
}
const screen = (selectionKey = 'openclaw:main') => <AdaptiveWorkspace routeName="Thread" selectionKey={selectionKey} roster={<Text>Roster</Text>}>
  {() => <Conversation />}
</AdaptiveWorkspace>;

beforeEach(() => { mockWidth = 1194; mockTablet = true; mounted.mockClear(); unmounted.mockClear(); });
it('keeps the conversation and draft mounted through collapse, rotation and small windows', () => {
  const r = render(screen());
  fireEvent.press(r.getByTestId('type'));
  expect(r.getByTestId('pane-width').props.children).toBe(894);
  fireEvent.press(r.getByTestId('toggle'));
  expect(r.getByTestId('pane-width').props.children).toBe(1194);
  mockWidth = 834; r.rerender(screen());
  expect(r.getByTestId('draft').props.children).toBe('中文草稿');
  mockWidth = 430; r.rerender(screen());
  expect(r.getByTestId('pane-width').props.children).toBe(430);
  mockWidth = 1194; r.rerender(screen());
  expect(r.getByTestId('pane-width').props.children).toBe(1194);
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});
it('opens a compact roster, dismisses on backdrop or a different scoped session', () => {
  mockWidth = 600;
  const r = render(screen());
  fireEvent.press(r.getByTestId('toggle'));
  expect(r.getByTestId('workspace-roster-drawer')).toBeTruthy();
  fireEvent.press(r.getByTestId('workspace-dismiss-roster'));
  expect(r.queryByTestId('workspace-roster-drawer')).toBeNull();
  fireEvent.press(r.getByTestId('toggle'));
  r.rerender(screen('hermes:main'));
  expect(r.queryByTestId('workspace-roster-drawer')).toBeNull();
});
it('preserves the phone navigation even with a wide window', () => {
  mockTablet = false;
  const r = render(screen());
  expect(r.getByTestId('toggle').props.onPress).toBeUndefined();
  expect(r.getByTestId('pane-width').props.children).toBe(1194);
});
