import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { ProGate, PRO_GATE_TEASER_HEIGHT } from './ProGate';

const lightColors = {
  canvas: '#FFFFFF',
  canvasGrouped: '#F5F5F7',
  surface: '#F2F2F4',
  surfaceFloating: '#FFFFFF',
  ink: '#111113',
  inkSecondary: '#6B6B72',
  inkTertiary: '#A3A3AB',
  line: '#E6E6EA',
  accent: '#1F5EFF',
};
const darkColors = {
  ...lightColors,
  canvas: '#0C0C0D',
  canvasGrouped: '#0C0C0D',
  surface: '#1A1A1D',
  surfaceFloating: '#222225',
  ink: '#F3F3F5',
  inkSecondary: '#9A9AA3',
  inkTertiary: '#6A6A73',
};
let mockTheme: { scheme: 'light' | 'dark'; colors: typeof lightColors } = { scheme: 'light', colors: lightColors };

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, style, ...props }: Record<string, unknown>) => ReactRuntime.createElement(
    name,
    { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style },
    children,
  );
  return {
    Pressable: host('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => {
        const list = Array.isArray(style) ? style.flat(Infinity) : [style];
        return Object.assign({}, ...list.filter(Boolean));
      },
    },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('react-native-svg', () => {
  const host = (name: string) => ({ children, ...props }: Record<string, unknown>) => require('react').createElement(name, props, children);
  return Object.assign(
    { __esModule: true },
    Object.fromEntries(['Svg', 'Defs', 'LinearGradient', 'Rect', 'Stop']
      .map((name) => [name === 'Svg' ? 'default' : name, host(name)])),
  );
});

jest.mock('lucide-react-native', () => ({
  LockKeyhole: (props: Record<string, unknown>) => require('react').createElement('LockKeyhole', props),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text: MockText } = require('react-native');
  return {
    Button: ({ testID, label, onPress }: { testID?: string; label: string; onPress?: () => void }) => (
      ReactRuntime.createElement(Pressable, { testID, onPress }, ReactRuntime.createElement(MockText, null, label))
    ),
  };
});

function flattenStyle(style: unknown): Record<string, unknown> {
  const { StyleSheet } = require('react-native');
  return StyleSheet.flatten(style) as Record<string, unknown>;
}

describe('ProGate', () => {
  beforeEach(() => {
    mockTheme = { scheme: 'light', colors: lightColors };
  });

  it('renders a plain notice without a teaser and unlocks on the action', () => {
    const onUnlock = jest.fn();
    const view = render(
      <ProGate testID="gate" title="Title" detail="Detail" actionLabel="Unlock" onUnlock={onUnlock} />,
    );
    expect(view.getByText('Title')).toBeTruthy();
    expect(view.getByText('Detail')).toBeTruthy();
    expect(view.queryByTestId('gate-teaser')).toBeNull();
    expect(flattenStyle(view.getByTestId('gate').props.style).minHeight).toBeUndefined();
    fireEvent.press(view.getByTestId('gate-action'));
    expect(onUnlock).toHaveBeenCalledTimes(1);
  });

  it('keeps real teaser content decorative beneath a veil that dissolves into the surface', () => {
    const view = render(
      <ProGate testID="gate" title="Title" actionLabel="Unlock" onUnlock={jest.fn()}>
        <Text>secret value</Text>
      </ProGate>,
    );
    // The teaser is outside the accessibility tree: default queries cannot see it.
    expect(view.queryByTestId('gate-teaser')).toBeNull();
    expect(view.queryByText('secret value')).toBeNull();
    const teaser = view.getByTestId('gate-teaser', { includeHiddenElements: true });
    expect(teaser.props.pointerEvents).toBe('none');
    expect(teaser.props.accessible).toBe(false);
    expect(teaser.props.accessibilityElementsHidden).toBe(true);
    expect(teaser.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(view.getByText('secret value', { includeHiddenElements: true })).toBeTruthy();
    const teaserStyle = flattenStyle(teaser.props.style);
    expect(teaserStyle.height).toBe(PRO_GATE_TEASER_HEIGHT);
    expect(teaserStyle.opacity).toBeLessThan(1);
    expect(flattenStyle(view.getByTestId('gate').props.style).minHeight).toBe(PRO_GATE_TEASER_HEIGHT);
    expect(flattenStyle(view.getByTestId('gate-notice').props.style).paddingTop).toBe(PRO_GATE_TEASER_HEIGHT / 2);

    const stops = view.UNSAFE_getAllByType('Stop' as never);
    expect(stops).toHaveLength(4);
    expect(stops.every((stop) => stop.props.stopColor === lightColors.canvasGrouped)).toBe(true);
    expect(stops[0]?.props.stopOpacity).toBe(0);
    expect(stops.at(-1)?.props.stopOpacity).toBe(1);
    const rect = view.UNSAFE_getByType('Rect' as never);
    const gradient = view.UNSAFE_getByType('LinearGradient' as never);
    expect(rect.props.fill).toBe(`url(#${String(gradient.props.id)})`);
  });

  it('dissolves into a caller surface and follows the dark palette', () => {
    mockTheme = { scheme: 'dark', colors: darkColors };
    const view = render(
      <ProGate
        testID="gate"
        title="Title"
        actionLabel="Unlock"
        surfaceColor={darkColors.surfaceFloating}
        teaserHeight={120}
        onUnlock={jest.fn()}
      >
        <Text>secret value</Text>
      </ProGate>,
    );
    const stops = view.UNSAFE_getAllByType('Stop' as never);
    expect(stops.every((stop) => stop.props.stopColor === darkColors.surfaceFloating)).toBe(true);
    expect(flattenStyle(view.getByTestId('gate-teaser', { includeHiddenElements: true }).props.style).height).toBe(120);
    expect(flattenStyle(view.getByText('Title').props.style).color).toBe(darkColors.ink);
  });
});
