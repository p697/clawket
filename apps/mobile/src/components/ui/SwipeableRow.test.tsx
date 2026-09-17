import React from 'react';
import { Text } from 'react-native';
import { fireEvent, render, renderHook } from '@testing-library/react-native';
import { Pin, Trash2 } from 'lucide-react-native';
import {
  SwipeableRow,
  useSwipeableRowGroup,
  type SwipeableRowAction,
} from './SwipeableRow';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, style, ...props }: { children?: React.ReactNode; style?: unknown }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, {
        ...props,
        ref,
        style: typeof style === 'function' ? style({ pressed: false }) : style,
      }, children)
    ),
  );
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: primitive('Pressable'),
    StyleSheet: {
      absoluteFill: {},
      create: <T extends Record<string, unknown>>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    View: primitive('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return { Pin: icon('Pin'), Trash2: icon('Trash2') };
});

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      scheme: 'light',
      colors: {
        ink: '#111113',
        surface: '#F2F2F4',
        bad: '#D64545',
        onAccent: '#FFFFFF',
      },
    },
  }),
}));

function actions(onPin = jest.fn(), onRemove = jest.fn()): ReadonlyArray<SwipeableRowAction> {
  return [
    { key: 'pin', label: 'Pin', icon: Pin, onPress: onPin },
    { key: 'remove', label: 'Remove', icon: Trash2, tone: 'destructive', onPress: onRemove },
  ];
}

describe('SwipeableRow', () => {
  it('reveals one cell per action, runs the action and closes the tray', () => {
    const onPin = jest.fn();
    const onRemove = jest.fn();
    const view = render(
      <SwipeableRow rowKey="a" actions={actions(onPin, onRemove)} testID="row">
        <Text>Agent</Text>
      </SwipeableRow>,
    );

    expect(view.getByText('Agent')).toBeTruthy();
    expect(view.getByText('Pin')).toBeTruthy();
    expect(view.getByText('Remove')).toBeTruthy();
    const remove = view.getByTestId('row-action-remove');
    expect(remove.props.accessibilityLabel).toBe('Remove');
    fireEvent.press(remove);
    expect(onRemove).toHaveBeenCalledTimes(1);
    expect(onPin).not.toHaveBeenCalled();
  });

  it('colours destructive cells with the semantic bad tone and neutral cells with surface', () => {
    const view = render(
      <SwipeableRow rowKey="a" actions={actions()} testID="row">
        <Text>Agent</Text>
      </SwipeableRow>,
    );
    const style = (id: string) => Object.assign(
      {},
      ...[view.getByTestId(id).props.style].flat(Infinity).filter(Boolean),
    );
    expect(style('row-action-pin').backgroundColor).toBe('#F2F2F4');
    expect(style('row-action-remove').backgroundColor).toBe('#D64545');
  });

  it('renders children alone when disabled or without actions', () => {
    const view = render(
      <SwipeableRow rowKey="a" actions={[]} testID="row">
        <Text>Agent</Text>
      </SwipeableRow>,
    );
    expect(view.queryByTestId('row')).toBeNull();
    expect(view.getByText('Agent')).toBeTruthy();

    view.rerender(
      <SwipeableRow rowKey="a" actions={actions()} enabled={false} testID="row">
        <Text>Agent</Text>
      </SwipeableRow>,
    );
    expect(view.queryByTestId('row-action-pin')).toBeNull();
  });

  it('keeps one tray open per group and closes it on demand', () => {
    const { result } = renderHook(() => useSwipeableRowGroup());
    const group = result.current;
    const first = { close: jest.fn(), openLeft: jest.fn(), openRight: jest.fn(), reset: jest.fn() };
    const second = { ...first, close: jest.fn() };
    group.register('first', first);
    group.register('second', second);

    group.opened('first');
    group.opened('second');
    expect(first.close).toHaveBeenCalledTimes(1);
    expect(second.close).not.toHaveBeenCalled();

    group.closeAll();
    expect(second.close).toHaveBeenCalledTimes(1);
    group.closeAll();
    expect(second.close).toHaveBeenCalledTimes(1);

    group.opened('second');
    group.closed('second');
    group.closeAll();
    expect(second.close).toHaveBeenCalledTimes(1);

    group.opened('first');
    group.register('first', null);
    group.closeAll();
    expect(first.close).toHaveBeenCalledTimes(1);
  });
});
