import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { StyleSheet, Text } from 'react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { ControlSize, FontSize, Radius, Space } from '../../theme/tokens';
import { ConfirmationModal } from './ConfirmationModal';
import { Button } from './Button';
import { SearchInput } from './SearchInput';
import { SegmentedTabs } from './SegmentedTabs';
import { FloatingButton } from './FloatingButton';
import { ThemedSwitch } from './ThemedSwitch';
import { Search } from 'lucide-react-native';
import { Sheet } from './Sheet';
import { SheetHeaderButton } from './SheetHeaderButton';

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
    ActivityIndicator: primitive('ActivityIndicator'),
    Modal: primitive('Modal'),
    Platform: {
      OS: 'ios',
      isMacCatalyst: false,
      isPad: false,
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    Pressable: primitive('Pressable'),
    StyleSheet: {
      absoluteFill: {},
      create: <T,>(styles: T) => styles,
      flatten,
      hairlineWidth: 1,
    },
    Switch: primitive('Switch'),
    Text: primitive('Text'),
    TextInput: primitive('TextInput'),
    useWindowDimensions: () => ({ width: 375, height: 812, scale: 3, fontScale: 1 }),
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
  Easing: {
    cubic: (value: number) => value ** 3,
    out: (easing: (value: number) => number) => (
      (value: number) => 1 - easing(1 - value)
    ),
  },
  default: {
    createAnimatedComponent: (component: React.ComponentType<unknown>) => component,
  },
  useAnimatedStyle: (factory: () => unknown) => factory(),
  useReducedMotion: () => false,
  useSharedValue: (value: unknown) => ({ value }),
  withTiming: (value: unknown) => value,
}));

jest.mock('../../theme', () => {
  const ReactRuntime = require('react');
  const { buildTheme: createTheme } = jest.requireActual('../../theme/theme');
  const { builtInAccents: accents } = jest.requireActual('../../theme/accents');
  return {
    ThemeContext: ReactRuntime.createContext(null),
    useAppTheme: () => ({
      theme: createTheme(mockScheme, mockScheme, accents.iceBlue),
    }),
  };
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }),
}));

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

  it('keeps a loading neutral action distinct from an unavailable action', () => {
    const onPress = jest.fn();
    const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);
    const view = render(<Button testID="neutral-action" label="Connect" variant="neutral" loading onPress={onPress} />);
    const loading = view.getByTestId('neutral-action');
    expect(flattened(loading.props.style)).toMatchObject({ backgroundColor: theme.colors.ink });
    expect(flattened(loading.props.style).opacity).toBeUndefined();
    expect(loading.props.accessibilityState).toMatchObject({ disabled: true, busy: true });
    expect(loading.props.disabled).toBe(true);
    view.rerender(<Button testID="neutral-action" label="Connect" variant="neutral" disabled onPress={onPress} />);
    expect(flattened(view.getByTestId('neutral-action').props.style).backgroundColor).toBe(theme.colors.surface);
    expect(view.getByTestId('neutral-action').props.accessibilityState.busy).toBe(false);
    view.rerender(<Button testID="neutral-action" label="Connect" variant="neutral" onPress={onPress} />);
    fireEvent.press(view.getByTestId('neutral-action'));
    expect(onPress).toHaveBeenCalledTimes(1);
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
      defaultValue: 'agent',
      placeholderTextColor: theme.colors.inkTertiary,
    });
    expect(result.getByTestId('search-input').props.value).toBeUndefined();
    fireEvent.press(result.getByTestId('search-clear'));
    expect(onChangeText).toHaveBeenCalledWith('');
  });

  it('supports flat search chrome without changing floating consumers', () => {
    const result = render(<SearchInput testID="quiet-search" value="" onChangeText={jest.fn()} appearance="quiet" />);
    const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);
    const style = flattened(result.getByTestId('quiet-search').props.style);
    expect(style.backgroundColor).toBe(theme.colors.surface);
    expect(style.shadowOpacity).toBeUndefined();
    expect(style.elevation).toBeUndefined();
    expect(style.borderWidth).toBeUndefined();
  });

  it('uses a canonical 44pt FloatingButton for sheet close', () => {
    const onClose = jest.fn();
    const result = render(
      <Sheet
        visible
        title="Options"
        onClose={onClose}
        closeAccessibilityLabel="Close"
        testID="navigation-sheet"
        headerRight={<Text testID="sheet-header-right">4s</Text>}
      >
        <Text>Content</Text>
      </Sheet>,
    );
    const close = result.getByTestId('navigation-sheet-close');

    expect(flattened(close.props.style)).toMatchObject({
      width: ControlSize.floatingButton,
      height: ControlSize.floatingButton,
      borderRadius: ControlSize.floatingButton / 2,
    });
    expect(close.props.accessibilityLabel).toBe('Close');
    expect(result.getByTestId('sheet-header-right')).toBeTruthy();
    fireEvent.press(close);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('keeps air between the sheet header and the body', () => {
    const result = render(
      <Sheet visible title="Models" onClose={jest.fn()} closeAccessibilityLabel="Close" testID="spaced-sheet">
        <Text>Content</Text>
      </Sheet>,
    );
    const header = flattened(result.getByTestId('spaced-sheet-header').props.style);
    expect(header.minHeight).toBe(ControlSize.settingsRow);
    expect(header.paddingBottom).toBe(Space.md);
  });

  it('gives a trailing SheetHeaderButton the same quiet chrome as the close button', () => {
    const onManage = jest.fn();
    const result = render(
      <Sheet
        visible
        title="Models"
        onClose={jest.fn()}
        closeAccessibilityLabel="Close"
        testID="action-sheet"
        headerRight={<SheetHeaderButton testID="action-sheet-manage" icon={Search} accessibilityLabel="Manage" onPress={onManage} />}
      >
        <Text>Content</Text>
      </Sheet>,
    );
    const close = flattened(result.getByTestId('action-sheet-close').props.style);
    const manage = flattened(result.getByTestId('action-sheet-manage').props.style);
    expect(manage.backgroundColor).toBe(buildTheme(scheme, scheme, builtInAccents.iceBlue).colors.surface);
    expect(manage.backgroundColor).toBe(close.backgroundColor);
    expect(manage.width).toBe(close.width);
    expect(manage.height).toBe(close.height);
    expect(manage.borderRadius).toBe(close.borderRadius);
    fireEvent.press(result.getByTestId('action-sheet-manage'));
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('opens a sheet that initially mounts hidden and can reopen it after dismissal', () => {
    const onClose = jest.fn();
    const content = (visible: boolean) => <Sheet visible={visible} onClose={onClose}
      closeAccessibilityLabel="Close" title="Add" testID="first-open"><Text>Connect agent</Text></Sheet>;
    const result = render(content(false));
    expect(onClose).not.toHaveBeenCalled();
    result.rerender(content(true));
    expect(result.getByText('Connect agent')).toBeTruthy();
    result.rerender(content(false));
    expect(result.queryByText('Connect agent')).toBeNull();
    result.rerender(content(true));
    expect(result.getByText('Connect agent')).toBeTruthy();
  });

  it('keeps destructive confirmation in app-owned centered chrome', () => {
    const onClose = jest.fn();
    const onConfirm = jest.fn();
    const result = render(
      <ConfirmationModal
        visible
        title="Delete session?"
        message="This cannot be undone."
        cancelLabel="Cancel"
        confirmLabel="Delete"
        onClose={onClose}
        onConfirm={onConfirm}
        destructive
        testID="delete-confirmation"
      />,
    );

    expect(flattened(result.getByTestId('delete-confirmation-card').props.style)).toMatchObject({
      width: '100%',
      maxWidth: 440,
      alignSelf: 'center',
      borderRadius: Radius.xl,
    });
    expect(flattened(result.getByTestId('delete-confirmation').props.style)).toMatchObject({
      paddingTop: Space.md,
      paddingBottom: Space.xl,
      gap: Space.xl,
    });
    expect(result.getByText('This cannot be undone.')).toBeTruthy();
    fireEvent.press(result.getByTestId('delete-confirmation-confirm'));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.press(result.getByTestId('delete-confirmation-backdrop'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe.each(['light', 'dark'] as const)('review controls in %s', (scheme) => {
  beforeEach(() => { mockScheme = scheme; });

  it('never remounts or invents a false value for an enabled switch', () => {
    const onChange = jest.fn();
    const view = render(<ThemedSwitch testID="switch" value tone="neutral" onValueChange={onChange} />);
    const native = view.getByTestId('switch');
    expect(native.props.value).toBe(true);
    view.rerender(<ThemedSwitch testID="switch" value={false} tone="neutral" onValueChange={onChange} />);
    expect(view.getByTestId('switch')).toBe(native);
    fireEvent(view.getByTestId('switch'), 'valueChange', true);
    expect(onChange).toHaveBeenCalledWith(true);
    view.rerender(<ThemedSwitch testID="switch" value tone="neutral" onValueChange={onChange} />);
    expect(view.getByTestId('switch')).toBe(native);
    expect(native.props.value).toBe(true);
  });

  it('preserves the quiet disabled surface and dims only its glyph', () => {
    const view = render(<FloatingButton testID="circle" icon={Search} appearance="quiet" disabled accessibilityLabel="Search" onPress={jest.fn()} />);
    expect(view.getByTestId('circle').props.disabled).toBe(true);
    expect(StyleSheet.flatten(view.getByTestId('circle').props.style).opacity).toBe(1);
    expect(view.UNSAFE_getByType(Search).props.color).toBe(buildTheme(scheme, scheme, builtInAccents.iceBlue).colors.inkTertiary);
  });
});
