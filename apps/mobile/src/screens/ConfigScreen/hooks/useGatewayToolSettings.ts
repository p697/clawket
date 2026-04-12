import { useCallback, useEffect, useRef, useState } from 'react';
import { useGatewayPatch } from '../../../hooks/useGatewayPatch';
import { GatewayClient } from '../../../services/gateway';
import {
  DEFAULT_GATEWAY_TOOL_SETTINGS,
  loadGatewayToolSettingsBundle,
} from '../../../services/gateway-tool-settings';
import {
  ExecAsk,
  ExecSecurity,
  GatewayToolSettings,
  buildGatewayToolPatch,
} from '../../../utils/gateway-tool-settings';

type Params = {
  gateway: GatewayClient;
  gatewayEpoch: number;
  hasActiveGateway: boolean;
};

export function useGatewayToolSettings({ gateway, gatewayEpoch, hasActiveGateway }: Params) {
  const [webSearchEnabled, setWebSearchEnabledState] = useState(true);
  const [webFetchEnabled, setWebFetchEnabledState] = useState(true);
  const [execSecurity, setExecSecurityState] = useState<ExecSecurity>('deny');
  const [execAsk, setExecAskState] = useState<ExecAsk>('on-miss');
  const [mediaImageEnabled, setMediaImageEnabledState] = useState(true);
  const [mediaAudioEnabled, setMediaAudioEnabledState] = useState(true);
  const [mediaVideoEnabled, setMediaVideoEnabledState] = useState(true);
  const [linksEnabled, setLinksEnabledState] = useState(true);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const hashRef = useRef<string | null>(null);
  const { patchWithRestart } = useGatewayPatch(gateway);

  // Keep a ref of latest settings so auto-save always uses current values
  const settingsRef = useRef<GatewayToolSettings>(DEFAULT_GATEWAY_TOOL_SETTINGS);

  const applyParsed = useCallback((parsed: GatewayToolSettings) => {
    setWebSearchEnabledState(parsed.webSearchEnabled);
    setWebFetchEnabledState(parsed.webFetchEnabled);
    setExecSecurityState(parsed.execSecurity);
    setExecAskState(parsed.execAsk);
    setMediaImageEnabledState(parsed.mediaImageEnabled);
    setMediaAudioEnabledState(parsed.mediaAudioEnabled);
    setMediaVideoEnabledState(parsed.mediaVideoEnabled);
    setLinksEnabledState(parsed.linksEnabled);
    settingsRef.current = parsed;
  }, []);

  const loadToolSettings = useCallback(async () => {
    if (!hasActiveGateway) {
      setError(null);
      hashRef.current = null;
      applyParsed(DEFAULT_GATEWAY_TOOL_SETTINGS);
      return;
    }
    setLoading(true);
    try {
      const bundle = await loadGatewayToolSettingsBundle(gateway);
      applyParsed(bundle.settings);
      hashRef.current = bundle.configHash;
      setError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to load tool settings';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [gateway, hasActiveGateway, applyParsed]);

  useEffect(() => {
    void loadToolSettings();
  }, [loadToolSettings, gatewayEpoch]);

  // Auto-save: patch the gateway with the current (overridden) settings ref
  const autoSave = useCallback(async (override: Partial<GatewayToolSettings>) => {
    const hash = hashRef.current;
    if (!hasActiveGateway || !hash) return;

    const previous = settingsRef.current;
    const next = { ...previous, ...override };
    settingsRef.current = next;
    setSaving(true);
    const saved = await patchWithRestart({
      patch: buildGatewayToolPatch(next),
      configHash: hash,
      confirmation: true,
      onSuccess: async () => {
        await loadToolSettings();
        setError(null);
      },
      onError: async () => {
        await loadToolSettings();
      },
    });
    if (!saved) {
      applyParsed(previous);
    }
    setSaving(false);
  }, [applyParsed, hasActiveGateway, loadToolSettings, patchWithRestart]);

  // Wrapped setters: optimistic update + auto-save
  const setWebSearchEnabled = useCallback((v: boolean) => {
    setWebSearchEnabledState(v);
    void autoSave({ webSearchEnabled: v });
  }, [autoSave]);

  const setWebFetchEnabled = useCallback((v: boolean) => {
    setWebFetchEnabledState(v);
    void autoSave({ webFetchEnabled: v });
  }, [autoSave]);

  const setExecSecurity = useCallback((v: ExecSecurity) => {
    setExecSecurityState(v);
    void autoSave({ execSecurity: v });
  }, [autoSave]);

  const setExecAsk = useCallback((v: ExecAsk) => {
    setExecAskState(v);
    void autoSave({ execAsk: v });
  }, [autoSave]);

  const setMediaImageEnabled = useCallback((v: boolean) => {
    setMediaImageEnabledState(v);
    void autoSave({ mediaImageEnabled: v });
  }, [autoSave]);

  const setMediaAudioEnabled = useCallback((v: boolean) => {
    setMediaAudioEnabledState(v);
    void autoSave({ mediaAudioEnabled: v });
  }, [autoSave]);

  const setMediaVideoEnabled = useCallback((v: boolean) => {
    setMediaVideoEnabledState(v);
    void autoSave({ mediaVideoEnabled: v });
  }, [autoSave]);

  const setLinksEnabled = useCallback((v: boolean) => {
    setLinksEnabledState(v);
    void autoSave({ linksEnabled: v });
  }, [autoSave]);

  return {
    webSearchEnabled,
    setWebSearchEnabled,
    webFetchEnabled,
    setWebFetchEnabled,
    execSecurity,
    setExecSecurity,
    execAsk,
    setExecAsk,
    mediaImageEnabled,
    setMediaImageEnabled,
    mediaAudioEnabled,
    setMediaAudioEnabled,
    mediaVideoEnabled,
    setMediaVideoEnabled,
    linksEnabled,
    setLinksEnabled,
    loadingToolSettings: loading,
    savingToolSettings: saving,
    toolSettingsError: error,
    loadToolSettings,
    // Keep for backward compat — now a no-op since saves are auto
    saveToolSettings: loadToolSettings,
  };
}
