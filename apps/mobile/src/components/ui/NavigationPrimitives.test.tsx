import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet } from 'react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { ControlSize, FontSize, Radius } from '../../theme/tokens';
import { SearchInput } from './SearchInput';
import { SegmentedTabs } from './SegmentedTabs';

let mockScheme: 'light' | 'dark' = 'light';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  const flatten = (style: unknown): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    const append = (value: unknown): void => {
      if (!value) return;
      if (typeof value === 'function') {
        append(value({ pressed: false }));
      } else if (Array.isArray(value)) {
        value.forEach(append);
      } else if (typeof value === 'object') {
        Object.assign(result, value);
      }
    };
    append(style);
    return result;
  };
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: primitive('Pressable'),
    StyleSheet: { create: <T,>(styles: T) => styles, flatten, hairlineWidth: 1 },
    Text: primitive('Text'),
    TextInput: primitive('TextInput'),
    View: primitive('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (name: string) => (props: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props)
  );
  return { Search: icon('Search'), X: icon('X') };
});

jest.mock('react-native-reanimated', () => ({
  __esModule: true,
  default: {
    createAnimatedComponent: (component: React.ComponentType<unknown>) => component,
  },
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useReducedMotion: () => false,
  useSharedValue: (value: unknown) => ({ value }),
  withTiming: (value: unknown) => value,
}));

jest.mock('../../theme', () => {
  const { buildTheme: createTheme } = jest.requireActual('../../theme/theme');
  const { builtInAccents: accents } = jest.requireActual('../../theme/accents');
  return {
    useAppTheme: () => ({
      theme: createTheme(mockScheme, mockScheme, accents.iceBlue),
    }),
  };
});

jest.mock('../../services/haptics', () => ({
  triggerLightImpact: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

function flattened(style: unknown): Record<string, unknown> {
  return StyleSheet.flatten(style as never) as Record<string, unknown>;
}

describe.each(['light', 'dark'] as const)('%s navigation primitives', (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('uses the canonical full-round 44pt segmented control', () => {
    const onSwitch = jest.fn();
    const result = render(
      <SegmentedTabs
        testID="mode"
        active="grouped"
        tabs={[
          { key: 'grouped', label: 'Grouped' },
          { key: 'list', label: 'List' },
        ]}
        onSwitch={onSwitch}
      />,
    );
    const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);

    expect(flattened(result.getByTestId('mode').props.style)).toMatchObject({
      minHeight: ControlSize.floatingButton,
      borderRadius: Radius.full,
      backgroundColor: theme.colors.surface,
    });
    expect(result.getByTestId('mode-grouped').props.accessibilityState).toEqual({ selected: true });
    expect(flattened(result.getByText('Grouped').props.style)).toMatchObject({
      fontSize: FontSize.secondary,
      color: theme.colors.ink,
    });
    fireEvent.press(result.getByTestId('mode-list'));
    expect(onSwitch).toHaveBeenCalledWith('list');
  });

  it('renders canonical SearchInput chrome and clears through one action', () => {
    const onChangeText = jest.fn();
    const result = render(
      <SearchInput
        testID="search"
        value="agent"
        onChangeText={onChangeText}
        autoFocus
      />,
    );
    const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);

    expect(flattened(result.getByTestId('search').props.style)).toMatchObject({
      height: ControlSize.floatingButton,
      borderRadius: Radius.full,
      backgroundColor: theme.colors.surfaceFloating,
    });
    expect(result.getByTestId('search-input').props).toMatchObject({
      autoFocus: true,
      placeholderTextColor: theme.colors.inkTertiary,
    });
    fireEvent.press(result.getByTestId('search-clear'));
    expect(onChangeText).toHaveBeenCalledWith('');
  });
});
