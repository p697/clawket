import { act, renderHook } from '@testing-library/react-native';
import { useChatCommandPicker } from './useChatCommandPicker';
import { ConnectionState } from '../types';

describe('useChatCommandPicker', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) {
        return;
      }
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    jest.clearAllMocks();
  });

  it('does not open when gateway is not ready', () => {
    const runSilentCommandProbe = jest.fn();
    const { result } = renderHook(() =>
      useChatCommandPicker({
        connectionState: 'connecting',
        runSilentCommandProbe,
        sessionKey: 'agent:main:main',
        setInput: jest.fn(),
        setThinkingLevel: jest.fn(),
        submitMessage: jest.fn(),
        t: (key) => key,
      }),
    );

    expect(result.current.openCommandPicker('think')).toBe(false);
    expect(result.current.commandPickerVisible).toBe(false);
    expect(runSilentCommandProbe).not.toHaveBeenCalled();
  });

  it('loads options and marks current value', async () => {
    const runSilentCommandProbe = jest
      .fn()
      .mockResolvedValue('Current thinking level: medium\nOptions: low, medium, high, medium');
    const { result } = renderHook(() =>
      useChatCommandPicker({
        connectionState: 'ready',
        runSilentCommandProbe,
        sessionKey: 'agent:main:main',
        setInput: jest.fn(),
        setThinkingLevel: jest.fn(),
        submitMessage: jest.fn(),
        t: (key) => key,
      }),
    );

    expect(result.current.openCommandPicker('think')).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(runSilentCommandProbe).toHaveBeenCalledWith('/think');
    expect(result.current.commandPickerOptions).toEqual([
      { value: 'low', isCurrent: false },
      { value: 'medium', isCurrent: true },
      { value: 'high', isCurrent: false },
    ]);
  });

  it('writes command into input when disconnected before selection', async () => {
    const runSilentCommandProbe = jest.fn().mockResolvedValue('Options: low, medium');
    const setInput = jest.fn();
    const setThinkingLevel = jest.fn();
    const submitMessage = jest.fn();
    const { result, rerender } = renderHook(
      ({ connectionState }: { connectionState: ConnectionState }) =>
        useChatCommandPicker({
          connectionState,
          runSilentCommandProbe,
          sessionKey: 'agent:main:main',
          setInput,
          setThinkingLevel,
          submitMessage,
          t: (key) => key,
        }),
      {
        initialProps: { connectionState: 'ready' as ConnectionState },
      },
    );

    expect(result.current.openCommandPicker('think')).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    rerender({ connectionState: 'connecting' });
    act(() => {
      result.current.onSelectCommandOption('medium');
    });

    expect(setThinkingLevel).toHaveBeenCalledWith('medium');
    expect(setInput).toHaveBeenCalledWith('/think medium');
    expect(submitMessage).not.toHaveBeenCalled();
  });

  it('submits command when connected', async () => {
    const runSilentCommandProbe = jest.fn().mockResolvedValue('Options: low, medium');
    const submitMessage = jest.fn();
    const { result } = renderHook(() =>
      useChatCommandPicker({
        connectionState: 'ready',
        runSilentCommandProbe,
        sessionKey: 'agent:main:main',
        setInput: jest.fn(),
        setThinkingLevel: jest.fn(),
        submitMessage,
        t: (key) => key,
      }),
    );

    expect(result.current.openCommandPicker('reasoning')).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    act(() => {
      result.current.onSelectCommandOption('high');
    });

    expect(submitMessage).toHaveBeenCalledWith('/reasoning high', []);
  });

  it('probes /fast through the directive path and strips config suffix from current value', async () => {
    const runSilentCommandProbe = jest
      .fn()
      .mockResolvedValue('Current fast mode: on (config).\nOptions: on, off.');
    const { result } = renderHook(() =>
      useChatCommandPicker({
        connectionState: 'ready',
        runSilentCommandProbe,
        sessionKey: 'agent:main:main',
        setInput: jest.fn(),
        setThinkingLevel: jest.fn(),
        submitMessage: jest.fn(),
        t: (key) => key,
      }),
    );

    expect(result.current.openCommandPicker('fast')).toBe(true);
    await act(async () => {
      await Promise.resolve();
    });

    expect(runSilentCommandProbe).toHaveBeenCalledWith('/fast:');
    expect(result.current.commandPickerTitle).toBe('Fast');
    expect(result.current.commandPickerOptions).toEqual([
      { value: 'on', isCurrent: true },
      { value: 'off', isCurrent: false },
    ]);
  });
});
