import { renderHook } from '@testing-library/react-native';
import { useChatMessageEntrance } from './useChatMessageEntrance';
import { UiMessage } from '../types/chat';

jest.mock('react-native', () => ({
  Animated: {
    Value: class {
      value: number;

      constructor(value: number) {
        this.value = value;
      }
    },
    timing: () => ({
      start: jest.fn(),
    }),
  },
}));

function createMessage({
  id,
  role,
  ...rest
}: Partial<UiMessage> & Pick<UiMessage, 'id' | 'role'>): UiMessage {
  return {
    id,
    role,
    text: '',
    streaming: false,
    ...rest,
  };
}

describe('useChatMessageEntrance', () => {
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
  });

  it('marks only newly prepended messages for entrance animation', () => {
    const m1 = createMessage({ id: 'm1', role: 'assistant' });
    const m2 = createMessage({ id: 'm2', role: 'user' });
    const m3 = createMessage({ id: 'm3', role: 'assistant' });

    const { result, rerender } = renderHook(
      ({ listData }: { listData: UiMessage[] }) => useChatMessageEntrance({ listData }),
      {
        initialProps: { listData: [m2, m1] },
      },
    );

    expect(result.current.newMessageIds.size).toBe(0);

    rerender({ listData: [m3, m2, m1] });
    expect(result.current.newMessageIds.has('m3')).toBe(true);
    expect(result.current.newMessageIds.size).toBe(1);
  });

  it('does not animate the finalized assistant message after streaming', () => {
    const streaming = createMessage({ id: 'stream-1', role: 'assistant', streaming: true });
    const finalized = createMessage({ id: 'final-1', role: 'assistant', streaming: false });

    const { result, rerender } = renderHook(
      ({ listData }: { listData: UiMessage[] }) => useChatMessageEntrance({ listData }),
      {
        initialProps: { listData: [streaming] },
      },
    );

    expect(result.current.newMessageIds.size).toBe(0);

    rerender({ listData: [finalized] });
    expect(result.current.newMessageIds.size).toBe(0);
  });

  it('does not animate first history batch after empty start', () => {
    const m1 = createMessage({ id: 'm1', role: 'assistant' });
    const m2 = createMessage({ id: 'm2', role: 'user' });

    const { result, rerender } = renderHook(
      ({ listData }: { listData: UiMessage[] }) => useChatMessageEntrance({ listData }),
      {
        initialProps: { listData: [] },
      },
    );

    rerender({ listData: [m2, m1] });
    expect(result.current.newMessageIds.size).toBe(0);
  });
});
