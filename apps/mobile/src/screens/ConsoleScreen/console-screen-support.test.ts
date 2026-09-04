import { isConsoleScreenSupported } from './console-screen-support';
import type { GatewayBackendCapabilities } from '@clawket/agent-protocol';

describe('console-screen-support', () => {
  it('gates Discover and ClawHub through backend capabilities', () => {
    const openClawCaps: GatewayBackendCapabilities = {
      consoleRoot: true,
      gatewayConnection: true,
      chatAbort: true,
      chatAttachments: true,
      consoleDiscover: true,
      consoleClawHub: true,
      modelCatalog: true,
      modelSelection: true,
      configRead: true,
      configWrite: true,
      consoleFiles: true,
      consoleCron: true,
      consoleCronCreate: true,
      consoleSkills: true,
      consoleCost: true,
      consoleLogs: true,
      consoleUsage: true,
      consoleChannels: true,
      consoleNodes: true,
      consoleTools: true,
      consoleAgentList: true,
      consoleAgentDetail: true,
      consoleAgentSessionsBoard: true,
      consoleHeartbeat: true,
      openClawConfigScreens: true,
    };

    const hermesCaps: GatewayBackendCapabilities = {
      ...openClawCaps,
      consoleDiscover: true,
      consoleClawHub: false,
    };

    expect(isConsoleScreenSupported('Discover', openClawCaps)).toBe(true);
    expect(isConsoleScreenSupported('ClawHub', openClawCaps)).toBe(true);
    expect(isConsoleScreenSupported('Discover', hermesCaps)).toBe(true);
    expect(isConsoleScreenSupported('ClawHub', hermesCaps)).toBe(false);
    expect(isConsoleScreenSupported('AgentSessionsBoard', openClawCaps)).toBe(true);
    expect(isConsoleScreenSupported('AgentSessionsBoard', {
      ...hermesCaps,
      consoleAgentSessionsBoard: false,
    })).toBe(false);
  });
});
