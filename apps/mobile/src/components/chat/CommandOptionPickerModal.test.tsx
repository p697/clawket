import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { CommandOptionPickerModal } from './CommandOptionPickerModal';

jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }) => R.createElement(name, props, children);
  return { Platform: { OS: 'ios', select: (values: Record<string, unknown>) => values.ios ?? values.default },
    Pressable: host('Pressable'), Text: host('Text'), TouchableOpacity: host('TouchableOpacity'), View: host('View'),
    StyleSheet: { create: (value: unknown) => value, hairlineWidth: 1 } };
});
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetFlatList: ({ data, renderItem, ...props }: { data: unknown[]; renderItem: (info: { item: unknown }) => React.ReactNode }) => require('react').createElement('FlatList', props,
  data.map((item, index) => require('react').createElement(require('react').Fragment, { key: index }, renderItem({ item })))) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('lucide-react-native', () => ({ Check: () => null }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { accent: 'accent', ink: 'ink', inkSecondary: 'secondary', line: 'line', surface: 'surface' } } }) }));
jest.mock('../ui', () => ({ Sheet: ({ children, visible, title }: { children: React.ReactNode; visible: boolean; title: string }) => require('react').createElement('Sheet', { visible, title }, children) }));
jest.mock('../ui/ListSkeleton', () => ({ ListSkeleton: (props: Record<string, unknown>) => require('react').createElement('ListSkeleton', props) }));

const base = { title: 'Thinking Level', error: null, isSending: false, onClose: jest.fn(), onRetry: jest.fn(), onSelectOption: jest.fn() };

it('keeps the sheet mounted and its last options on screen while it slides away', () => {
  const view = render(<CommandOptionPickerModal {...base} visible loading={false} options={[{ value: 'low' }, { value: 'high', isCurrent: true }]} />);
  expect(view.getByText('high')).toBeTruthy();
  // Closing clears the picker state in the same update that hides the sheet.
  view.rerender(<CommandOptionPickerModal {...base} visible={false} title="" loading={false} options={[]} />);
  expect(view.UNSAFE_getByType('Sheet' as never).props).toMatchObject({ visible: false, title: 'Thinking Level' });
  expect(view.getByText('high')).toBeTruthy();
  expect(view.queryByText('No options available')).toBeNull();
  view.rerender(<CommandOptionPickerModal {...base} visible title="Speed" loading options={[]} />);
  expect(view.getByTestId('command-option-loading')).toBeTruthy();
  expect(view.UNSAFE_getByType('Sheet' as never).props.title).toBe('Speed');
});

it('retries a failed option load through the shared borderless button', () => {
  const onRetry = jest.fn();
  const view = render(<CommandOptionPickerModal {...base} onRetry={onRetry} visible loading={false} error="Options unavailable" options={[]} />);
  expect(view.getByText('Options unavailable')).toBeTruthy();
  const retry = view.getByTestId('command-option-retry');
  expect(retry.props.accessibilityRole).toBe('button');
  fireEvent.press(retry);
  expect(onRetry).toHaveBeenCalledTimes(1);
});
