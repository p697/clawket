import { useGatewayConfigForm } from '../../../hooks/useGatewayConfigForm';
import { useAppContext } from '../../../contexts/AppContext';
import { useAppTheme } from '../../../theme';
import { useGatewayRuntimeSettings } from './useGatewayRuntimeSettings';

export function useConfigScreenController() {
  const {
    gateway,
    gatewayEpoch,
    config: initialConfig,
    debugMode,
    showAgentAvatar,
    showModelUsage,
    onSaved,
    onReset,
    onDebugToggle,
    onShowAgentAvatarToggle,
    onShowModelUsageToggle,
    execApprovalEnabled,
    onExecApprovalToggle,
    nodeEnabled,
    onNodeEnabledToggle,
    chatFontSize,
    onChatFontSizeChange,
    speechRecognitionLanguage,
    onSpeechRecognitionLanguageChange,
  } = useAppContext();
  const { theme, mode, accentId, setMode, setAccentId, systemScheme, resolvedScheme } = useAppTheme();

  const form = useGatewayConfigForm({
    gateway,
    initialConfig,
    debugMode,
    onSaved,
    onReset,
  });

  const gatewayRuntimeSettings = useGatewayRuntimeSettings({
    gateway,
    gatewayEpoch,
    hasActiveGateway: Boolean(initialConfig?.url),
  });

  return {
    gateway,
    hasActiveGateway: Boolean(initialConfig?.url),
    theme,
    mode,
    accentId,
    setMode,
    setAccentId,
    systemScheme,
    resolvedScheme,
    debugMode,
    showAgentAvatar,
    showModelUsage,
    onDebugToggle,
    onShowAgentAvatarToggle,
    onShowModelUsageToggle,
    execApprovalEnabled,
    onExecApprovalToggle,
    nodeEnabled,
    onNodeEnabledToggle,
    chatFontSize,
    onChatFontSizeChange,
    speechRecognitionLanguage,
    onSpeechRecognitionLanguageChange,
    ...gatewayRuntimeSettings,
    ...form,
  };
}
