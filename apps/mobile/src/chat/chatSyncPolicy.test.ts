import { getChatHeaderSyncState, hasActiveGatewayConfig } from './chatSyncPolicy';

describe('chatSyncPolicy', () => {
  it('treats missing gateway config as sync-disabled', () => {
    expect(hasActiveGatewayConfig(null)).toBe(false);
    expect(hasActiveGatewayConfig({ url: '   ' } as { url: string })).toBe(false);

    expect(getChatHeaderSyncState({
      config: null,
      sessionKey: null,
      connectionState: 'idle',
      refreshing: true,
      historyLoaded: false,
      isSending: false,
    })).toEqual({
      isConnecting: false,
      status: null,
      busy: false,
    });
  });

  it('keeps configured users on the normal connecting path before a session is selected', () => {
    expect(getChatHeaderSyncState({
      config: { url: 'ws://gateway.example' } as { url: string },
      sessionKey: null,
      connectionState: 'idle',
      refreshing: false,
      historyLoaded: false,
      isSending: false,
    })).toEqual({
      isConnecting: true,
      status: 'connecting_gateway',
      busy: true,
    });
  });

  it('shows the Hermes startup state only for Hermes before a session is selected', () => {
    expect(getChatHeaderSyncState({
      config: { url: 'ws://gateway.example', backendKind: 'hermes' } as { url: string; backendKind: 'hermes' },
      sessionKey: null,
      connectionState: 'idle',
      refreshing: false,
      historyLoaded: false,
      isSending: false,
    })).toEqual({
      isConnecting: true,
      status: 'starting_hermes',
      busy: true,
    });
  });

  it('shows conversation refresh only after a session exists', () => {
    expect(getChatHeaderSyncState({
      config: { url: 'ws://gateway.example' } as { url: string },
      sessionKey: 'agent:main:main',
      connectionState: 'ready',
      refreshing: true,
      historyLoaded: true,
      isSending: false,
    })).toEqual({
      isConnecting: false,
      status: 'refreshing_conversation',
      busy: true,
    });
  });
});
