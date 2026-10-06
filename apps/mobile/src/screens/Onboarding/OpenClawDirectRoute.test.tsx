import React from 'react';
import { act, render, waitFor } from '@testing-library/react-native';
import { OpenClawDirectRoute } from './OpenClawDirectRoute';
import type { OpenClawDirectScreenProps } from './OpenClawDirectScreen';

let mockProps: OpenClawDirectScreenProps;
let mockSnapshot: { connections: unknown[]; activeConnectionId: string | null; activeState: string; activePairingRequired?: boolean; error: { message: string } | null };
let mockIsPro = false;
const mockConnect = jest.fn();
const mockFind = jest.fn(async (..._args: unknown[]) => undefined as { id: string; isFreeSlot: boolean } | undefined);
const mockPause = jest.fn(async () => {});
jest.mock('react-native', () => ({ Keyboard: { dismiss: jest.fn() } }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => {}) }));
jest.mock('@react-navigation/native', () => ({ useFocusEffect: (callback: () => (() => void)) => require('react').useEffect(callback, [callback]) }));
jest.mock('../../connection', () => ({
  ...jest.requireActual('../../connection/pairing/openclaw-direct'),
  getConnectionRuntime: () => ({ getSnapshot: () => mockSnapshot, pauseConnection: mockPause }),
  useConnections: () => mockSnapshot,
  findOpenClawDirectConnection: (...args: unknown[]) => mockFind(...args),
  connectOpenClawDirect: (...args: unknown[]) => mockConnect(...args),
}));
jest.mock('../../contexts/ProPaywallContext', () => ({ useProPaywall: () => ({ isPro: mockIsPro }) }));
jest.mock('./OpenClawDirectScreen', () => ({ OpenClawDirectScreen: (props: OpenClawDirectScreenProps) => { mockProps = props; return null; } }));
const draft = { mode: 'local', url: 'ws://192.168.1.2:18789', authMethod: 'token', credential: 'secret' } as const;
const saved = { id: 'direct', backendKind: 'openclaw' };
const props = () => ({ navigation: { goBack: jest.fn() }, route: { name: 'OpenClawDirect' }, onConnected: jest.fn(), onOpenPaywall: jest.fn() });

beforeEach(() => {
  jest.clearAllMocks(); mockIsPro = false; mockFind.mockResolvedValue(undefined);
  mockSnapshot = { connections: [], activeConnectionId: null, activeState: 'idle', error: null };
  mockConnect.mockImplementation(async (input) => {
    input.onSaved(saved); mockSnapshot.activeConnectionId = saved.id; mockSnapshot.activeState = 'ready'; return saved;
  });
});
describe('direct setup lifecycle', () => {
  it('validates before entitlement or network work, then enters only after a Gateway handshake', async () => {
    const p = props(); render(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => mockProps.onSubmit({ ...draft, url: 'ftp://host' }));
    expect(mockProps.error).toBe('url'); expect(mockConnect).not.toHaveBeenCalled();
    act(() => mockProps.onSubmit(draft));
    await waitFor(() => expect(p.onConnected).toHaveBeenCalledWith({ connectionId: 'direct', backendKind: 'openclaw' }));
  });
  it('guards double taps and cancels a late result when the reader goes back', async () => {
    let finish!: (result: unknown) => void;
    mockConnect.mockImplementation((input) => { input.onSaved(saved); mockSnapshot.activeConnectionId = saved.id; return new Promise(r => { finish = r; }); });
    const p = props(); render(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => { mockProps.onSubmit(draft); mockProps.onSubmit(draft); });
    expect(mockConnect).toHaveBeenCalledTimes(1);
    act(() => mockProps.onBack());
    await act(async () => { mockSnapshot.activeState = 'ready'; finish(saved); });
    expect(mockPause).toHaveBeenCalledWith('direct'); expect(p.onConnected).not.toHaveBeenCalled();
    expect(mockConnect.mock.calls[0][0].isCurrent()).toBe(false);
  });
  it('shows auth errors without advancing and allows the same saved attempt to retry', async () => {
    mockConnect.mockImplementation(async (input) => { input.onSaved(saved); mockSnapshot.connections = [saved]; mockSnapshot.activeConnectionId = 'direct'; mockSnapshot.error = { message: 'unauthorized' }; return saved; });
    const p = props(); const view = render(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => mockProps.onSubmit(draft));
    await waitFor(() => expect(mockProps.error).toBe('unauthorized'));
    expect(p.onConnected).not.toHaveBeenCalled();
    view.rerender(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => mockProps.onSubmit(draft));
    await waitFor(() => expect(mockConnect).toHaveBeenCalledTimes(2));
    expect(p.onOpenPaywall).not.toHaveBeenCalled();
    expect(mockConnect.mock.calls[1][0].retryConnectionId).toBe('direct');
  });
  it('shows device approval even when the pending handshake has no runtime error', async () => {
    mockConnect.mockImplementation(async (input) => {
      input.onSaved(saved); mockSnapshot.activeConnectionId = saved.id;
      mockSnapshot.activeState = 'offline'; mockSnapshot.activePairingRequired = true;
      return saved;
    });
    const p = props(); render(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => mockProps.onSubmit(draft));
    await waitFor(() => expect(mockProps.busy).toBe(false));
    expect(mockProps.error).toBe('pairing_required');
    expect(p.onConnected).not.toHaveBeenCalled();
  });
  it('gates an additional connection and retires a paywall continuation on departure', async () => {
    mockSnapshot.connections = [saved];
    const p = props(); const view = render(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => mockProps.onSubmit(draft));
    await waitFor(() => expect(p.onOpenPaywall).toHaveBeenCalledWith('gatewayConnections', expect.any(Function)));
    expect(mockConnect).not.toHaveBeenCalled();
    const continuation = p.onOpenPaywall.mock.calls[0][1]; view.unmount();
    act(() => continuation()); expect(mockConnect).not.toHaveBeenCalled();
  });
  it('bounds an unresponsive handshake and pauses its own connection on timeout', async () => {
    jest.useFakeTimers();
    mockConnect.mockImplementation((input) => { input.onSaved(saved); mockSnapshot.activeConnectionId = 'direct'; return new Promise(() => {}); });
    const p = props(); const view = render(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => mockProps.onSubmit(draft));
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(mockProps.error).toBe('network'); expect(mockPause).toHaveBeenCalledWith('direct');
    expect(p.onConnected).not.toHaveBeenCalled(); view.unmount(); jest.useRealTimers();
  });
  it('keeps explicit approval instructions when a pending handshake reaches its deadline', async () => {
    jest.useFakeTimers();
    mockConnect.mockImplementation((input) => { input.onSaved(saved); mockSnapshot.activeConnectionId = 'direct'; mockSnapshot.activePairingRequired = true; return new Promise(() => {}); });
    const p = props(); const view = render(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => mockProps.onSubmit(draft));
    await act(async () => { jest.advanceTimersByTime(30_000); });
    expect(mockProps.error).toBe('pairing_required'); expect(mockPause).toHaveBeenCalledWith('direct');
    expect(p.onConnected).not.toHaveBeenCalled(); view.unmount(); jest.useRealTimers();
  });
  it('allows reopening the existing free endpoint without a Pro paywall', async () => {
    mockSnapshot.connections = [saved]; mockFind.mockResolvedValue({ id: 'direct', isFreeSlot: true });
    const p = props(); render(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => mockProps.onSubmit(draft));
    await waitFor(() => expect(p.onConnected).toHaveBeenCalled());
    expect(p.onOpenPaywall).not.toHaveBeenCalled(); expect(mockConnect.mock.calls[0][0].retryConnectionId).toBe('direct');
  });
  it('retires a pending paywall draft when the form changes', async () => {
    mockSnapshot.connections = [saved];
    const p = props(); render(<OpenClawDirectRoute {...(p as unknown as React.ComponentProps<typeof OpenClawDirectRoute>)} />);
    act(() => mockProps.onSubmit(draft));
    await waitFor(() => expect(p.onOpenPaywall).toHaveBeenCalled());
    const continuation = p.onOpenPaywall.mock.calls[0][1];
    act(() => mockProps.onDraftChanged?.()); act(() => continuation());
    expect(mockConnect).not.toHaveBeenCalled();
  });

});
