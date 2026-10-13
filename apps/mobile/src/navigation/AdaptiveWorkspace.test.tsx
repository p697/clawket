import React, { useEffect, useState } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { I18nManager, Pressable, Text, View } from 'react-native';
import { AdaptiveWorkspace } from './AdaptiveWorkspace';
import { useWorkspaceLayout } from './workspace-context';

let mockWidth = 1194;
let mockPlatform = 'ios';
let mockInsets = { left: 0, right: 0 };
jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: any) => R.createElement(name, props, children);
  return {
    I18nManager: { isRTL: false },
    Platform: { OS: 'ios', isPad: false, select: (options: Record<string, unknown>) => options.ios ?? options.default }, View: host('View'), Text: host('Text'), Pressable: host('Pressable'),
    StyleSheet: { create: (s: unknown) => s, absoluteFill: { position: 'absolute' }, flatten: (s: unknown) => s },
    useWindowDimensions: () => ({ width: mockWidth, height: 834, fontScale: 1 }) };
});
jest.mock('../utils/platform', () => ({ getRuntimePlatform: () => mockPlatform }));
jest.mock('../theme', () => ({ useAppTheme: () => ({ theme: { colors: { canvas: 'white', scrim: 'black' } } }) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => mockInsets }));
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

beforeEach(() => { mockWidth = 1194; mockPlatform = 'ios'; mockInsets = { left: 0, right: 0 }; I18nManager.isRTL = false; mounted.mockClear(); unmounted.mockClear(); });
it('uses Duo inner space for two panes and preserves the draft through folds and inset-only collapse', () => {
  mockWidth = 951;
  mockInsets = { left: 0, right: 84 };
  const r = render(screen());
  fireEvent.press(r.getByTestId('type'));
  expect(r.getByTestId('pane-width').props.children).toBe(567);
  mockInsets = { left: 12, right: 84 }; r.rerender(screen());
  expect(r.getByTestId('pane-width').props.children).toBe(555);
  mockInsets = { left: 28, right: 84 }; r.rerender(screen());
  expect(r.getByTestId('pane-width').props.children).toBe(839);
  mockWidth = 466; mockInsets = { left: 0, right: 84 }; r.rerender(screen());
  expect(r.getByTestId('pane-width').props.children).toBe(382);
  mockWidth = 951; r.rerender(screen());
  expect(r.getByTestId('pane-width').props.children).toBe(567);
  expect(r.getByTestId('draft').props.children).toBe('中文草稿');
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});
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
it.each(['android', 'macos'])('preserves %s navigation even with a wide window', platform => {
  mockPlatform = platform;
  mockInsets = { left: 64, right: 24 };
  I18nManager.isRTL = true;
  const r = render(screen());
  expect(r.getByTestId('toggle').props.onPress).toBeUndefined();
  expect(r.getByTestId('pane-width').props.children).toBeUndefined();
  expect(Object.assign({}, ...r.getByTestId('workspace').props.style)).toMatchObject({ paddingLeft: 64, paddingRight: 24 });
});
it('closes the drawer when the window becomes compact and does not reopen it on expansion', () => {
  mockWidth = 700;
  const r = render(screen());
  fireEvent.press(r.getByTestId('type'));
  fireEvent.press(r.getByTestId('toggle'));
  expect(r.getByTestId('workspace-roster-drawer')).toBeTruthy();
  mockWidth = 390; r.rerender(screen());
  expect(r.queryByTestId('workspace-roster-drawer')).toBeNull();
  expect(r.getByTestId('toggle').props.onPress).toBeUndefined();
  mockWidth = 700; r.rerender(screen());
  expect(r.queryByTestId('workspace-roster-drawer')).toBeNull();
  expect(r.getByTestId('draft').props.children).toBe('中文草稿');
  expect(mounted).toHaveBeenCalledTimes(1);
  expect(unmounted).not.toHaveBeenCalled();
});
it.each([false, true])('uses physical safe areas for the pane and drawer and reacts to inset-only changes (RTL=%s)', rtl => {
  I18nManager.isRTL = rtl;
  mockWidth = 744;
  mockInsets = { left: 64, right: 24 };
  const r = render(screen());
  fireEvent.press(r.getByTestId('toggle'));
  const expected = { paddingStart: rtl ? 24 : 64, paddingEnd: rtl ? 64 : 24 };
  expect(Object.assign({}, ...r.getByTestId('workspace').props.style)).toMatchObject(expected);
  expect(Object.assign({}, ...r.getByTestId('workspace-roster-overlay').props.style)).toMatchObject(expected);
  expect(r.getByTestId('pane-width', { includeHiddenElements: true }).props.children).toBe(656);
  mockInsets = { left: 80, right: 80 }; r.rerender(screen());
  expect(r.getByTestId('pane-width').props.children).toBe(584);
  expect(r.queryByTestId('workspace-roster-drawer')).toBeNull();
  mockInsets = { left: 24, right: 64 }; r.rerender(screen());
  expect(r.queryByTestId('workspace-roster-drawer')).toBeNull();
  expect(Object.assign({}, ...r.getByTestId('workspace').props.style)).toMatchObject({ paddingStart: rtl ? 64 : 24, paddingEnd: rtl ? 24 : 64 });
});
