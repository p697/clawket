import type { GatewayBackendCapabilities } from '../../services/gateway-backends';
import type { ConsoleStackParamList } from './sharedNavigator';

export function isConsoleScreenSupported(
  screen: keyof ConsoleStackParamList,
  capabilities: GatewayBackendCapabilities,
): boolean {
  switch (screen) {
    case 'ConsoleMenu':
    case 'Docs':
    case 'ChatHistory':
    case 'ChatHistoryDetail':
    case 'FavoriteMessageDetail':
    case 'SessionsBoard':
      return true;
    case 'AgentSessionsBoard':
      return capabilities.consoleAgentSessionsBoard;
    case 'Discover':
      return capabilities.consoleDiscover;
    case 'ClawHub':
      return capabilities.consoleClawHub;
    case 'FileList':
    case 'FileEditor':
      return capabilities.consoleFiles;
    case 'CronList':
    case 'CronDetail':
    case 'CronEditor':
    case 'CronWizard':
      return capabilities.consoleCron;
    case 'SkillList':
    case 'SkillDetail':
    case 'SkillContent':
      return capabilities.consoleSkills;
    case 'Logs':
      return capabilities.consoleLogs;
    case 'Usage':
      return capabilities.consoleUsage;
    case 'ModelList':
      return capabilities.modelCatalog;
    case 'Channels':
      return capabilities.consoleChannels;
    case 'Nodes':
    case 'Devices':
    case 'NodeDetail':
      return capabilities.consoleNodes;
    case 'ToolList':
      return capabilities.consoleTools && capabilities.configRead;
    case 'AgentList':
      return capabilities.consoleAgentList;
    case 'AgentDetail':
    case 'AgentUserInfo':
      return capabilities.consoleAgentDetail;
    case 'HeartbeatSettings':
      return capabilities.consoleHeartbeat;
    default:
      return true;
  }
}
