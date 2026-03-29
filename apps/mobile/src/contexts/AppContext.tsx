import React from 'react';
import type WebView from 'react-native-webview';
import type { WebViewMessageEvent } from 'react-native-webview/lib/WebViewTypes';
import { GatewayClient } from '../services/gateway';
import { LastOpenedSessionSnapshot } from '../services/storage';
import { GatewayConfig } from '../types';
import type { AgentInfo } from '../types/agent';
import type { NodeCapabilityToggles } from '../services/node-capabilities';
import type { ChatAppearanceSettings, SpeechRecognitionLanguage } from '../types';

export type SessionSidebarTab = 'sessions' | 'subagents' | 'cron';

export type ChatSidebarRequest = {
  requestedAt: number;
  tab: SessionSidebarTab;
  channel?: string;
  openDrawer: boolean;
};

export type ChatNotificationOpenRequest = {
  requestedAt: number;
  sessionKey: string;
  agentId?: string;
  runId?: string;
};

export type AppContextType = {
  gateway: GatewayClient;
  activeGatewayConfigId: string | null;
  gatewayEpoch: number;
  foregroundEpoch: number;
  config: GatewayConfig | null;
  debugMode: boolean;
  showAgentAvatar: boolean;
  officeChatRequest: {
    sessionKey: string;
    requestedAt: number;
    sourceRole?: string;
  } | null;
  chatSidebarRequest: ChatSidebarRequest | null;
  pendingChatNotificationOpen: ChatNotificationOpenRequest | null;
  agents: AgentInfo[];
  currentAgentId: string;
  initialChatPreview: LastOpenedSessionSnapshot | null;
  mainSessionKey: string;
  isMultiAgent: boolean;
  setCurrentAgentId: (id: string) => void;
  /** Switch to agent and signal Chat to switch session. Use this instead of setCurrentAgentId when switching agents. */
  switchAgent: (id: string) => void;
  /** Pending agent switch target. Chat controller consumes and clears this. */
  pendingAgentSwitch: string | null;
  clearPendingAgentSwitch: () => void;
  agentAvatars: Record<string, string>;
  setAgentAvatars: (map: Record<string, string>) => void;
  setAgents: (agents: AgentInfo[]) => void;
  showModelUsage: boolean;
  execApprovalEnabled: boolean;
  canvasEnabled: boolean;
  chatFontSize: number;
  chatAppearance: ChatAppearanceSettings;
  speechRecognitionLanguage: SpeechRecognitionLanguage;
  onDebugToggle: (enabled: boolean) => void;
  onShowAgentAvatarToggle: (show: boolean) => void;
  onShowModelUsageToggle: (enabled: boolean) => void;
  onExecApprovalToggle: (enabled: boolean) => void;
  onCanvasToggle: (enabled: boolean) => void;
  nodeEnabled: boolean;
  onNodeEnabledToggle: (enabled: boolean) => void;
  nodeCapabilityToggles: NodeCapabilityToggles;
  onNodeCapabilityTogglesChange: (toggles: NodeCapabilityToggles) => void;
  onChatFontSizeChange: (size: number) => void;
  onChatAppearanceChange: (settings: ChatAppearanceSettings) => void;
  onSpeechRecognitionLanguageChange: (language: SpeechRecognitionLanguage) => void;
  requestOfficeChat: (sessionKey: string, sourceRole?: string) => void;
  clearOfficeChatRequest: () => void;
  requestChatSidebar: (params?: { tab?: SessionSidebarTab; channel?: string; openDrawer?: boolean }) => void;
  clearChatSidebarRequest: () => void;
  requestOpenChatFromNotification: (params: {
    sessionKey: string;
    agentId?: string;
    runId?: string;
  }) => void;
  clearPendingChatNotificationOpen: () => void;
  pendingChatInput: string | null;
  pendingMainSessionSwitch: boolean;
  requestChatWithInput: (text: string) => void;
  clearPendingChatInput: () => void;
  clearPendingMainSessionSwitch: () => void;
  pendingAddGateway: boolean;
  requestAddGateway: () => void;
  clearPendingAddGateway: () => void;
  onSaved: (next: GatewayConfig, nextGatewayScopeId?: string | null) => void;
  onReset: () => void;
  officeWebViewRef: React.RefObject<WebView | null>;
  officeMessageHandlerRef: React.MutableRefObject<((e: WebViewMessageEvent) => void) | null>;
  officeLoadEndHandlerRef: React.MutableRefObject<(() => void) | null>;
  officeDebugAppendRef: React.MutableRefObject<((msg: string) => void) | null>;
  isOfficeFocused: boolean;
};

const AppContext = React.createContext<AppContextType | null>(null);

type AppContextProviderProps = {
  value: AppContextType;
  children: React.ReactNode;
};

export function AppContextProvider({ value, children }: AppContextProviderProps): React.JSX.Element {
  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useAppContext(): AppContextType {
  const context = React.useContext(AppContext);
  if (!context) {
    throw new Error('useAppContext must be used within AppContextProvider');
  }
  return context;
}
