import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ThinkingLevelPickerModal } from './ThinkingLevelPickerModal';

jest.mock('react-native', () => ({
  Pressable: 'Pressable', Text: 'Text', View: 'View',
  StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
}));

jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('expo-haptics', () => ({ impactAsync: jest.fn(), ImpactFeedbackStyle: { Light: 'light' } }));
jest.mock('lucide-react-native', () => ({ Check: () => null }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { ink: '#111', line: '#eee', surface: '#fff', accent: '#111' } } }) }));
jest.mock('../ui', () => ({ Sheet: ({ children, ...props }: Record<string, unknown>) => require('react').createElement('View', props, children) }));
jest.mock('@gorhom/bottom-sheet', () => ({ BottomSheetFlatList: ({ data, renderItem, ...props }: Record<string, any>) => {
  const R = require('react');
  return R.createElement('View', { ...props, testID: 'thinking-integrated-list' }, data.map((item: { value: string }) => R.createElement(R.Fragment, { key: item.value }, renderItem({ item }))));
} }));

it('keeps every thinking option in an expandable integrated list and selects the last option', () => {
  const onSelect = jest.fn();
  const view = render(<ThinkingLevelPickerModal visible current="adaptive" onClose={jest.fn()} onSelect={onSelect} />);
  expect(view.getByTestId('thinking-level-sheet').props.snapPoints).toEqual(['72%', '92%']);
  expect(view.getByTestId('thinking-integrated-list').props.contentContainerStyle.paddingHorizontal).toBe(24);
  expect(view.getByText('thinking_adaptive').parent?.props.accessibilityState.selected).toBe(true);
  fireEvent.press(view.getByText('thinking_adaptive'));
  expect(onSelect).toHaveBeenCalledWith('adaptive');
});
