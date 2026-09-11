import React from 'react';
import {
  act,
  fireEvent,
  render,
  waitFor,
} from '@testing-library/react-native';
import {
  AdapterError,
  CAPABILITY_MATRIX,
  type AgentAdapter,
  type LogPage,
} from '@clawket/agent-protocol';

import { LogsSection } from './LogsSection';

const colors = {
  canvas: '#FFFFFF',
  canvasGrouped: '#F5F5F7',
  surface: '#F2F2F4',
  surfaceFloating: '#FFFFFF',
  ink: '#111113',
  inkSecondary: '#6B6B72',
  inkTertiary: '#A3A3AB',
  line: '#E6E6EA',
  accent: '#1F5EFF',
  good: '#178A6A',
  warn: '#D9791C',
  bad: '#D64545',
};

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(
    ({ children, style, ...props }: Record<string, unknown>, ref: unknown) => ReactRuntime.createElement(
      name,
      {
        ...props,
        ref,
        style: typeof style === 'function' ? style({ pressed: false }) : style,
      },
      children,
    ),
  );
  return {
    Platform: {
      OS: 'ios',
      select: (options: Record<string, unknown>) => options.ios ?? options.default,
    },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: (() => {
    const t = (key: string) => key;
    return () => ({ t });
  })(),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: { scheme: 'light', colors } }),
}));

jest.mock('../../components/ui/Banner', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    Banner: ({ testID, message, actionLabel, onAction }: {
      testID?: string;
      message: string;
      actionLabel?: string;
      onAction?: () => void;
    }) => ReactRuntime.createElement(
      View,
      { testID },
      ReactRuntime.createElement(Text, null, message),
      actionLabel
        ? ReactRuntime.createElement(
          Pressable,
          { testID: `${testID}-action`, onPress: onAction },
          ReactRuntime.createElement(Text, null, actionLabel),
        )
        : null,
    ),
  };
});

jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ testID, label, disabled, loading, onPress }: {
      testID?: string;
      label: string;
      disabled?: boolean;
      loading?: boolean;
      onPress?: () => void;
    }) => ReactRuntime.createElement(
      Pressable,
      { testID, disabled: disabled || loading, onPress: disabled || loading ? undefined : onPress },
      ReactRuntime.createElement(Text, null, label),
    ),
  };
});

jest.mock('../../components/ui/SearchInput', () => {
  const ReactRuntime = require('react');
  const { TextInput } = require('react-native');
  return {
    SearchInput: ({ testID, value, onChangeText, placeholder }: {
      testID?: string;
      value: string;
      onChangeText: (value: string) => void;
      placeholder?: string;
    }) => ReactRuntime.createElement(TextInput, {
      testID: `${testID}-input`,
      value,
      onChangeText,
      placeholder,
    }),
  };
});

jest.mock('../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, props),
  };
});

function page(lines: string[], cursor = 10, reset = false): LogPage {
  return {
    file: '/tmp/gateway.log',
    cursor,
    size: lines.length,
    lines,
    truncated: false,
    reset,
  };
}

function adapterWith(fetch: jest.Mock, logs = true): AgentAdapter {
  return {
    capabilities: { ...CAPABILITY_MATRIX.openclaw, logs },
    management: { logs: { fetch } },
  } as unknown as AgentAdapter;
}

const infoLine = JSON.stringify({
  time: '2026-09-05T10:00:01Z',
  _meta: { logLevelName: 'INFO', name: 'gateway' },
  message: 'Gateway ready',
});
const errorLine = JSON.stringify({
  time: '2026-09-05T10:00:02Z',
  _meta: { logLevelName: 'ERROR', name: 'bridge' },
  message: 'Bridge closed',
});

describe('LogsSection', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('renders loading, parses entries, searches, filters, and refreshes through the adapter', async () => {
    let resolveInitial: ((result: LogPage) => void) | undefined;
    const fetch = jest.fn()
      .mockImplementationOnce(() => new Promise<LogPage>((resolve) => {
        resolveInitial = resolve;
      }))
      .mockResolvedValue(page([infoLine, errorLine], 20, true));
    const view = render(<LogsSection adapter={adapterWith(fetch)} online />);

    expect(view.getByTestId('agent-logs-loading')).toBeTruthy();
    await act(async () => resolveInitial?.(page([infoLine, errorLine])));
    await waitFor(() => expect(view.getByTestId('agent-logs-list')).toBeTruthy());
    expect(view.getByText('Bridge closed')).toBeTruthy();
    expect(view.getByText('Gateway ready')).toBeTruthy();

    fireEvent.press(view.getByTestId('agent-logs-filter-info'));
    expect(view.queryByText('Gateway ready')).toBeNull();
    fireEvent.changeText(view.getByTestId('agent-logs-search-input'), 'bridge');
    expect(view.getByText('Bridge closed')).toBeTruthy();

    fireEvent.press(view.getByTestId('agent-logs-refresh'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(fetch.mock.calls[1]?.[0]).toEqual({ limit: 500, maxBytes: 250_000 });
  });

  it('polls incrementally from the adapter cursor', async () => {
    jest.useFakeTimers();
    const fetch = jest.fn()
      .mockResolvedValueOnce(page([infoLine], 7))
      .mockResolvedValueOnce(page([errorLine], 9));
    const view = render(<LogsSection adapter={adapterWith(fetch)} online />);
    await act(async () => undefined);
    expect(fetch).toHaveBeenCalledTimes(1);

    await act(async () => {
      jest.advanceTimersByTime(2_000);
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(fetch.mock.calls[1]?.[0]).toEqual({
      cursor: 7,
      limit: 500,
      maxBytes: 250_000,
    });
    expect(view.getByText('Bridge closed')).toBeTruthy();
  });

  it('shows a stable error and retries only on the explicit action', async () => {
    const fetch = jest.fn()
      .mockRejectedValueOnce(new AdapterError('server', 'private detail'))
      .mockResolvedValueOnce(page([infoLine]));
    const view = render(<LogsSection adapter={adapterWith(fetch)} online />);

    await waitFor(() => expect(view.getByTestId('agent-logs-error')).toBeTruthy());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(view.getByText('Server error')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-logs-error-action'));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(view.queryByTestId('agent-logs-error')).toBeNull());
  });

  it('renders the empty state after a successful empty page', async () => {
    const fetch = jest.fn(async () => page([]));
    const view = render(<LogsSection adapter={adapterWith(fetch)} online />);
    await waitFor(() => expect(view.getByTestId('agent-logs-empty')).toBeTruthy());
  });

  it('retains cached entries while offline and disables refresh', async () => {
    const fetch = jest.fn(async () => page([infoLine]));
    const adapter = adapterWith(fetch);
    const view = render(<LogsSection adapter={adapter} online />);
    await waitFor(() => expect(view.getByText('Gateway ready')).toBeTruthy());

    view.rerender(<LogsSection adapter={adapter} online={false} />);
    expect(view.getByTestId('agent-logs-offline')).toBeTruthy();
    expect(view.getByText('Gateway ready')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-logs-refresh'));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('never fetches when the logs capability is absent', () => {
    const fetch = jest.fn();
    const view = render(<LogsSection adapter={adapterWith(fetch, false)} online />);
    expect(view.getByTestId('agent-logs-unsupported')).toBeTruthy();
    expect(fetch).not.toHaveBeenCalled();
  });
});
