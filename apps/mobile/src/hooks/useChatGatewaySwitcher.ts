import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GatewayConfig, SavedGatewayConfig } from '../types';
import type { GatewayClient } from '../connection/protocol';
import { StorageService } from '../services/storage';
import { useGatewayOverlay } from '../contexts/GatewayOverlayContext';
import { reconnectGatewayWithOverlay, toRuntimeConfig } from '../connection/pairing/gateway-scan-flow';

type Params = {
  activeGatewayConfigId: string | null;
  config: GatewayConfig | null;
  debugMode: boolean;
  gateway: GatewayClient;
  onSaved: (config: GatewayConfig, nextGatewayScopeId?: string | null) => void;
};

function normalizeActiveConfigId(activeGatewayConfigId: string | null): string | null {
  const trimmed = activeGatewayConfigId?.trim();
  if (!trimmed?.startsWith('cfg:')) return null;
  return trimmed.slice(4) || null;
}

export function useChatGatewaySwitcher({
  activeGatewayConfigId,
  config,
  debugMode,
  gateway,
  onSaved,
}: Params) {
  const { t } = useTranslation('common');
  const { hideOverlay, showOverlay } = useGatewayOverlay();
  const [configs, setConfigs] = useState<SavedGatewayConfig[]>([]);
  const [activeConfigId, setActiveConfigId] = useState<string | null>(
    normalizeActiveConfigId(activeGatewayConfigId),
  );
  const [loading, setLoading] = useState(true);
  const [switchTimerRef] = useState<{ current: ReturnType<typeof setTimeout> | null }>({ current: null });

  const refreshConfigs = useCallback(async () => {
    setLoading(true);
    try {
      const savedState = await StorageService.getGatewayConfigsState();
      setConfigs(savedState.configs);
      setActiveConfigId(savedState.activeId);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refreshConfigs();
  }, [refreshConfigs]);

  useEffect(() => {
    void StorageService.getGatewayConfigsState()
      .then((savedState) => {
        setConfigs(savedState.configs);
        setActiveConfigId(savedState.activeId ?? normalizeActiveConfigId(activeGatewayConfigId));
      })
      .catch(() => {
        const normalized = normalizeActiveConfigId(activeGatewayConfigId);
        setActiveConfigId(normalized);
      });
  }, [activeGatewayConfigId]);

  useEffect(() => () => {
    if (switchTimerRef.current) {
      clearTimeout(switchTimerRef.current);
    }
  }, [switchTimerRef]);

  const activateConfig = useCallback(async (configId: string): Promise<void> => {
    const target = configs.find((item) => item.id === configId);
    if (!target || configId === activeConfigId) return;

    setActiveConfigId(configId);
    await StorageService.setGatewayConfigsState({ activeId: configId, configs });

    reconnectGatewayWithOverlay({
      gateway,
      runtimeConfig: toRuntimeConfig(target, debugMode || Boolean(config?.debugMode)),
      nextGatewayScopeId: `cfg:${target.id}`,
      onSaved,
      showOverlay,
      hideOverlay,
      message: t('Switching Gateway...'),
      switchTimerRef,
    });
  }, [
    activeConfigId,
    config?.debugMode,
    configs,
    debugMode,
    gateway,
    hideOverlay,
    onSaved,
    showOverlay,
    switchTimerRef,
    t,
  ]);

  return {
    activeConfigId,
    activateConfig,
    configs,
    loading,
    refreshConfigs,
  };
}
