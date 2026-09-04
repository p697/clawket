import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ArrowUp, Lock, Square } from 'lucide-react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import {
  BorderWidth,
  ControlSize,
  FontSize,
  LineHeight,
  Radius,
  Shadow,
  Space,
} from '../../theme/tokens';
import { ApprovalCard } from './ApprovalCard';
import { Bubble } from './Bubble';
import { Composer } from './Composer';
import { RunCard } from './RunCard';
import { SettingsDivider, SettingsGroup, SettingsRow } from './SettingsGroup';
import { Sheet } from './Sheet';

let mockScheme: 'light' | 'dark' = 'light';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    Modal: primitive('Modal'),
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: primitive('Pressable'),
    StyleSheet: {
      absoluteFillObject: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      create: <T extends Record<string, unknown>>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    TextInput: primitive('TextInput'),
    View: primitive('View'),
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const animatedPrimitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    __esModule: true,
    default: {
      View: animatedPrimitive('AnimatedView'),
      createAnimatedComponent: (Component: React.ComponentType<unknown>) => Component,
    },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: jest.fn((value: unknown) => value),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return {
    ArrowUp: icon('ArrowUp'),
    ChevronRight: icon('ChevronRight'),
    Lock: icon('Lock'),
    Mic: icon('Mic'),
    Plus: icon('Plus'),
    Square: icon('Square'),
    X: icon('X'),
  };
});

jest.mock('../../theme', () => {
  const { buildTheme: createTheme } = jest.requireActual('../../theme/theme');
  const { builtInAccents: accents } = jest.requireActual('../../theme/accents');
  return {
    useAppTheme: () => ({
      theme: createTheme(mockScheme, mockScheme, accents.iceBlue),
    }),
  };
});

let consoleErrorSpy: jest.SpyInstance;

beforeAll(() => {
  const originalConsoleError = console.error;
  consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown, ...rest: unknown[]) => {
    if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    originalConsoleError(message, ...rest);
  });
});

afterAll(() => {
  consoleErrorSpy.mockRestore();
});

type StyleValue = Record<string, unknown> | ReadonlyArray<unknown> | null | false | undefined;

function flattenStyle(style: StyleValue | ((state: { pressed: boolean }) => StyleValue), pressed = false) {
  const result: Record<string, unknown> = {};
  const append = (value: StyleValue | ((state: { pressed: boolean }) => StyleValue)): void => {
    if (!value) return;
    if (typeof value === 'function') {
      append(value({ pressed }));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach((entry) => append(entry as StyleValue));
      return;
    }
    Object.assign(result, value);
  };
  append(style);
  return result;
}

function activeTheme(scheme: 'light' | 'dark') {
  return buildTheme(scheme, scheme, builtInAccents.iceBlue);
}

describe.each(['light', 'dark'] as const)('%s thread primitives', (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('renders the two canonical bubble variants without surface borders', () => {
    const theme = activeTheme(scheme);
    const assistant = render(<Bubble testID="assistant" role="assistant">Hello</Bubble>);
    const assistantStyle = flattenStyle(assistant.getByTestId('assistant').props.style);
    expect(assistantStyle).toMatchObject({
      maxWidth: '82%',
      borderRadius: Radius.bubble,
      backgroundColor: theme.colors.surface,
      alignSelf: 'flex-start',
    });
    expect(assistantStyle).not.toHaveProperty('borderWidth');
    expect(flattenStyle(assistant.getByText('Hello').props.style)).toMatchObject({
      color: theme.colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
    });

    const user = render(<Bubble testID="user" role="user">Hi</Bubble>);
    expect(flattenStyle(user.getByTestId('user').props.style)).toMatchObject({
      backgroundColor: theme.colors.accentSoft,
      alignSelf: 'flex-end',
      borderRadius: Radius.bubble,
    });
  });

  it('renders a borderless run card with a tokenized status rail', () => {
    const theme = activeTheme(scheme);
    const onPress = jest.fn();
    const result = render(
      <RunCard
        testID="run"
        title="Nightly sync"
        detail="Failed · 2m"
        tone="bad"
        onPress={onPress}
      />,
    );
    const cardStyle = flattenStyle(result.getByTestId('run').props.style);
    expect(cardStyle).toMatchObject({
      backgroundColor: theme.colors.surface,
      borderRadius: Radius.card,
    });
    expect(cardStyle).not.toHaveProperty('borderWidth');
    expect(flattenStyle(result.getByTestId('run-status').props.style)).toMatchObject({
      width: BorderWidth.emphasis,
      backgroundColor: theme.colors.bad,
    });
    fireEvent.press(result.getByTestId('run'));
    expect(onPress).toHaveBeenCalledTimes(1);
  });

  it('renders approval preview and two semantic capsule actions', () => {
    const theme = activeTheme(scheme);
    const allow = jest.fn();
    const alwaysAllow = jest.fn();
    const reject = jest.fn();
    const result = render(
      <ApprovalCard
        testID="approval"
        title="Allow exec?"
        command="npm test"
        primaryAction={{ label: 'Allow', onPress: allow, onLongPress: alwaysAllow }}
        secondaryAction={{ label: 'Reject', onPress: reject }}
      />,
    );
    const cardStyle = flattenStyle(result.getByTestId('approval').props.style);
    expect(cardStyle).toMatchObject({
      backgroundColor: theme.colors.surface,
      borderRadius: Radius.card,
    });
    expect(cardStyle).not.toHaveProperty('borderWidth');
    expect(flattenStyle(result.getByTestId('approval-command').props.style)).toMatchObject({
      fontFamily: 'monospace',
      fontSize: FontSize.caption,
      lineHeight: LineHeight.caption,
    });
    expect(flattenStyle(result.getByTestId('approval-primary').props.style)).toMatchObject({
      minHeight: ControlSize.pill,
      borderRadius: Radius.full,
      backgroundColor: theme.colors.ink,
    });
    expect(flattenStyle(result.getByTestId('approval-secondary').props.style).backgroundColor)
      .toBe(theme.colors.surfaceFloating);
    fireEvent.press(result.getByTestId('approval-primary'));
    fireEvent(result.getByTestId('approval-primary'), 'longPress');
    fireEvent.press(result.getByTestId('approval-secondary'));
    expect(allow).toHaveBeenCalledTimes(1);
    expect(alwaysAllow).toHaveBeenCalledTimes(1);
    expect(reject).toHaveBeenCalledTimes(1);
  });

  it('uses 44pt floating actions and a five-line composition field', () => {
    const theme = activeTheme(scheme);
    const send = jest.fn();
    const stop = jest.fn();
    const labels = { add: 'Add', voice: 'Voice', send: 'Send', stop: 'Stop' };
    const result = render(
      <Composer
        testID="composer"
        value="Draft"
        placeholder="Ask Main"
        accessibilityLabels={labels}
        onChangeText={jest.fn()}
        onAddPress={jest.fn()}
        onVoicePress={jest.fn()}
        onSend={send}
        onStop={stop}
      />,
    );
    const inputShell = flattenStyle(result.getByTestId('composer-input-shell').props.style);
    expect(inputShell).toMatchObject({
      minHeight: ControlSize.floatingButton,
      borderRadius: Radius.full,
      backgroundColor: theme.colors.surfaceFloating,
    });
    if (scheme === 'light') {
      expect(inputShell.shadowRadius).toBe(Shadow.floating.shadowRadius);
      expect(inputShell.elevation).toBe(Shadow.floating.elevation);
    } else {
      expect(inputShell.borderWidth).toBe(BorderWidth.hairline);
      expect(inputShell.borderColor).toBe(theme.colors.line);
    }
    const input = result.getByTestId('composer-input');
    expect(input.props).toMatchObject({ multiline: true, scrollEnabled: true });
    expect(flattenStyle(input.props.style)).toMatchObject({
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
      maxHeight: LineHeight.body * 5,
    });
    expect(flattenStyle(result.getByTestId('composer-add').props.style).width)
      .toBe(ControlSize.floatingButton);
    expect(flattenStyle(result.getByTestId('composer-primary').props.style).backgroundColor)
      .toBe(theme.colors.accent);
    expect(result.UNSAFE_getByType(ArrowUp)).toBeTruthy();
    fireEvent.press(result.getByTestId('composer-primary'));
    expect(send).toHaveBeenCalledTimes(1);

    result.rerender(
      <Composer
        testID="composer"
        value=""
        placeholder="Ask Main"
        accessibilityLabels={labels}
        onChangeText={jest.fn()}
        onSend={send}
        onStop={stop}
        isRunning
      />,
    );
    expect(flattenStyle(result.getByTestId('composer-primary').props.style).backgroundColor)
      .toBe(theme.colors.ink);
    expect(result.UNSAFE_getByType(Square)).toBeTruthy();
    fireEvent.press(result.getByTestId('composer-primary'));
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('renders bottom sheet chrome with one 40 percent backdrop and a visible close action', () => {
    const theme = activeTheme(scheme);
    const onClose = jest.fn();
    const result = render(
      <Sheet
        testID="sheet"
        visible
        title="Sessions"
        closeAccessibilityLabel="Close"
        onClose={onClose}
      >
        <></>
      </Sheet>,
    );
    const sheetStyle = flattenStyle(result.getByTestId('sheet').props.style);
    expect(sheetStyle).toMatchObject({
      backgroundColor: theme.colors.surface,
      borderTopLeftRadius: Radius.bottomSheet,
      borderTopRightRadius: Radius.bottomSheet,
    });
    expect(sheetStyle).not.toHaveProperty('borderWidth');
    expect(flattenStyle(result.getByTestId('sheet-handle').props.style)).toMatchObject({
      width: ControlSize.compact,
      height: Space.xs,
      backgroundColor: theme.colors.line,
    });
    expect(flattenStyle(result.getByTestId('sheet-backdrop').props.style)).toMatchObject({
      backgroundColor: scheme === 'dark' ? theme.colors.canvas : theme.colors.ink,
      opacity: 0.4,
    });
    expect(result.getByTestId('sheet-close')).toBeTruthy();
    fireEvent.press(result.getByTestId('sheet-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps settings rows borderless and reserves the hairline for dividers', () => {
    const theme = activeTheme(scheme);
    const result = render(
      <SettingsGroup testID="settings">
        <SettingsRow
          testID="settings-row"
          title="Connection"
          value="Offline"
          attention
          locked
          onPress={jest.fn()}
        />
        <SettingsDivider testID="settings-divider" inset="content" />
      </SettingsGroup>,
    );
    expect(flattenStyle(result.getByTestId('settings').props.style)).toMatchObject({
      backgroundColor: theme.colors.surfaceFloating,
      borderRadius: Radius.settingsGroup,
    });
    const restingRow = flattenStyle(result.getByTestId('settings-row').props.style);
    const pressedRow = flattenStyle(result.getByTestId('settings-row').props.style, true);
    expect(restingRow.minHeight).toBe(ControlSize.settingsRow);
    expect(restingRow).not.toHaveProperty('borderWidth');
    expect(pressedRow.backgroundColor).toBe(theme.colors.surface);
    expect(flattenStyle(result.getByText('Connection').props.style)).toMatchObject({
      color: theme.colors.ink,
      fontSize: FontSize.body,
      lineHeight: LineHeight.body,
    });
    expect(flattenStyle(result.getByText('Offline').props.style)).toMatchObject({
      color: theme.colors.inkSecondary,
      fontSize: FontSize.secondary,
      lineHeight: LineHeight.secondary,
    });
    expect(result.UNSAFE_getByType(Lock)).toBeTruthy();
    expect(flattenStyle(result.getByTestId('settings-row-attention').props.style).backgroundColor)
      .toBe(theme.colors.bad);
    expect(flattenStyle(result.getByTestId('settings-divider').props.style)).toMatchObject({
      height: BorderWidth.hairline,
      backgroundColor: theme.colors.line,
      marginLeft: Space.lg,
    });
  });
});
