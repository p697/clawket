import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useGatewayPatch } from '../../../hooks/useGatewayPatch';
import { getGatewayBackendCapabilities } from '../../../services/gateway-backends';
import { GatewayClient, GatewayInfo } from '../../../services/gateway';
import {
  DEFAULT_GATEWAY_RUNTIME_SETTINGS,
  loadGatewayRuntimeSettingsBundle,
} from '../../../services/gateway-runtime-settings';
import { isNewerVersion } from '../../../utils/version';
import { buildGatewayRuntimePatch } from '../../../utils/gateway-settings';
import { publicAppLinks } from '../../../config/public';

const ACTIVE_HOURS_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const ACTIVE_HOURS_END_PATTERN = /^(([01]\d|2[0-3]):([0-5]\d)|24:00)$/;

type Params = {
  gateway: GatewayClient;
  gatewayEpoch: number;
  hasActiveGateway: boolean;
};

type GatewayUpdateInfo = {
  currentVersion: string;
  latestVersion: string;
};

async function fetchLatestOpenClawVersion(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
      },
    });
    if (!response.ok) return null;
    const payload = await response.json() as { tag_name?: unknown; name?: unknown };
    const tag = typeof payload.tag_name === 'string' ? payload.tag_name : null;
    if (tag?.trim()) return tag.trim();
    const name = typeof payload.name === 'string' ? payload.name : null;
    return name?.trim() || null;
  } catch {
    return null;
  }
}

export function useGatewayRuntimeSettings({ gateway, gatewayEpoch, hasActiveGateway }: Params) {
  const { t } = useTranslation('config');
  const capabilities = getGatewayBackendCapabilities(gateway.getBackendKind());
  const [heartbeatEvery, setHeartbeatEvery] = useState('');
  const [heartbeatActiveStart, setHeartbeatActiveStart] = useState('');
  const [heartbeatActiveEnd, setHeartbeatActiveEnd] = useState('');
  const [heartbeatActiveTimezone, setHeartbeatActiveTimezone] = useState('');
  const [heartbeatSession, setHeartbeatSession] = useState('');
  const [heartbeatModel, setHeartbeatModel] = useState('');
  const [defaultModel, setDefaultModel] = useState('');
  const [fallbackModels, setFallbackModels] = useState<string[]>([]);
  const [thinkingDefault, setThinkingDefault] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);
  const [gatewayUpdateInfo, setGatewayUpdateInfo] = useState<GatewayUpdateInfo | null>(null);
  const [loadingGatewaySettings, setLoadingGatewaySettings] = useState(false);
  const [savingGatewaySettings, setSavingGatewaySettings] = useState(false);
  const [restartingGateway, setRestartingGateway] = useState(false);
  const [gatewaySettingsError, setGatewaySettingsError] = useState<string | null>(null);
  const [gatewaySettingsHash, setGatewaySettingsHash] = useState<string | null>(null);
  const { patchWithRestart } = useGatewayPatch(gateway);

  const loadGatewaySettings = useCallback(async () => {
    if (!hasActiveGateway) {
      setGatewaySettingsError(null);
      setGatewaySettingsHash(null);
      setAvailableModels([]);
      setHeartbeatEvery(DEFAULT_GATEWAY_RUNTIME_SETTINGS.heartbeatEvery);
      setHeartbeatActiveStart(DEFAULT_GATEWAY_RUNTIME_SETTINGS.heartbeatActiveStart);
      setHeartbeatActiveEnd(DEFAULT_GATEWAY_RUNTIME_SETTINGS.heartbeatActiveEnd);
      setHeartbeatActiveTimezone(DEFAULT_GATEWAY_RUNTIME_SETTINGS.heartbeatActiveTimezone);
      setHeartbeatSession(DEFAULT_GATEWAY_RUNTIME_SETTINGS.heartbeatSession);
      setHeartbeatModel(DEFAULT_GATEWAY_RUNTIME_SETTINGS.heartbeatModel);
      setDefaultModel(DEFAULT_GATEWAY_RUNTIME_SETTINGS.defaultModel);
      setFallbackModels(DEFAULT_GATEWAY_RUNTIME_SETTINGS.fallbackModels);
      setThinkingDefault(DEFAULT_GATEWAY_RUNTIME_SETTINGS.thinkingDefault);
      setGatewayInfo(null);
      setGatewayUpdateInfo(null);
      return;
    }
    setLoadingGatewaySettings(true);
    try {
      const bundle = await loadGatewayRuntimeSettingsBundle(gateway, {
        canReadConfig: capabilities.configRead,
        canListModels: capabilities.modelCatalog,
      });
      setHeartbeatEvery(bundle.settings.heartbeatEvery);
      setHeartbeatActiveStart(bundle.settings.heartbeatActiveStart);
      setHeartbeatActiveEnd(bundle.settings.heartbeatActiveEnd);
      setHeartbeatActiveTimezone(bundle.settings.heartbeatActiveTimezone);
      setHeartbeatSession(bundle.settings.heartbeatSession);
      setHeartbeatModel(bundle.settings.heartbeatModel);
      setDefaultModel(bundle.settings.defaultModel);
      setFallbackModels(bundle.settings.fallbackModels);
      setThinkingDefault(bundle.settings.thinkingDefault);
      setGatewayInfo(gateway.getGatewayInfo());
      setGatewaySettingsHash(bundle.configHash);
      setAvailableModels(bundle.availableModels);
      setGatewayUpdateInfo(null);
      setGatewaySettingsError(null);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : t('Failed to load gateway settings');
      setGatewaySettingsError(message);
    } finally {
      setLoadingGatewaySettings(false);
    }
  }, [capabilities.configRead, capabilities.modelCatalog, gateway, hasActiveGateway]);

  useEffect(() => {
    void loadGatewaySettings();
  }, [loadGatewaySettings, gatewayEpoch]);

  useEffect(() => {
    const currentVersion = gatewayInfo?.version?.trim();
    if (!currentVersion) {
      setGatewayUpdateInfo(null);
      return;
    }

    let cancelled = false;
    const resolveFromGitHub = async () => {
      const releaseApiUrl = publicAppLinks.openClawLatestReleaseApiUrl;
      if (!releaseApiUrl) {
        setGatewayUpdateInfo(null);
        return;
      }
      const latestVersion = await fetchLatestOpenClawVersion(releaseApiUrl);
      if (cancelled || !latestVersion) return;
      if (!isNewerVersion(latestVersion, currentVersion)) {
        setGatewayUpdateInfo(null);
        return;
      }
      setGatewayUpdateInfo({ currentVersion, latestVersion });
    };
    void resolveFromGitHub();

    return () => {
      cancelled = true;
    };
  }, [gatewayInfo?.version]);

  const saveGatewaySettings = useCallback(async () => {
    if (!hasActiveGateway) {
      Alert.alert(t('No Active Gateway'), t('Please add and activate a gateway connection first.'));
      return;
    }
    if (!capabilities.configWrite) {
      Alert.alert(t('Unavailable'), t('This backend does not support editing runtime settings yet.'));
      return;
    }
    if (!gatewaySettingsHash) {
      Alert.alert(t('Settings Unavailable'), t('Gateway config hash is missing. Please refresh and try again.'));
      return;
    }
    const trimmedStart = heartbeatActiveStart.trim();
    const trimmedEnd = heartbeatActiveEnd.trim();
    if ((trimmedStart || trimmedEnd) && (!trimmedStart || !trimmedEnd)) {
      Alert.alert(t('Invalid Active Hours'), t('Start and end time must both be set.'));
      return;
    }
    if (trimmedStart && !ACTIVE_HOURS_PATTERN.test(trimmedStart)) {
      Alert.alert(t('Invalid Start Time'), t('Use 24-hour format: HH:MM'));
      return;
    }
    if (trimmedEnd && !ACTIVE_HOURS_END_PATTERN.test(trimmedEnd)) {
      Alert.alert(t('Invalid End Time'), t('Use HH:MM, and only 24:00 is allowed for 24:xx.'));
      return;
    }
    if (trimmedStart === '24:00') {
      Alert.alert(t('Invalid Start Time'), t('Start time cannot be 24:00.'));
      return;
    }

    setSavingGatewaySettings(true);
    await patchWithRestart({
      patch: buildGatewayRuntimePatch({
        heartbeatEvery,
        heartbeatActiveStart,
        heartbeatActiveEnd,
        heartbeatActiveTimezone,
        heartbeatSession,
        heartbeatModel,
        defaultModel,
        fallbackModels,
        thinkingDefault,
      }),
      configHash: gatewaySettingsHash,
      confirmation: true,
      onSuccess: async () => {
        await loadGatewaySettings();
        setGatewaySettingsError(null);
      },
      onError: async () => {
        await loadGatewaySettings();
      },
    });
    setSavingGatewaySettings(false);
  }, [
    capabilities.configWrite,
    defaultModel,
    fallbackModels,
    gatewaySettingsHash,
    hasActiveGateway,
    heartbeatActiveEnd,
    heartbeatActiveStart,
    heartbeatActiveTimezone,
    heartbeatEvery,
    heartbeatModel,
    heartbeatSession,
    loadGatewaySettings,
    patchWithRestart,
    thinkingDefault,
  ]);

  const restartGateway = useCallback(async () => {
    if (!hasActiveGateway) {
      return;
    }
    if (!capabilities.configWrite) {
      setGatewaySettingsError(t('This backend does not support restart from the app yet.'));
      return;
    }

    setRestartingGateway(true);

    let hash = gatewaySettingsHash;
    if (!hash) {
      try {
        const configPayload = await gateway.getConfig();
        hash = configPayload.hash;
        setGatewaySettingsHash(configPayload.hash);
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : t('Failed to load gateway settings');
        setGatewaySettingsError(message);
        setRestartingGateway(false);
        return;
      }
    }

    if (!hash) {
      setGatewaySettingsError(t('Gateway config hash is missing. Please refresh and try again.'));
      setRestartingGateway(false);
      return;
    }

    await patchWithRestart({
      patch: {},
      configHash: hash,
      savingMessage: t('Requesting Gateway restart...'),
      restartingMessage: t('Restarting Gateway...'),
      onSuccess: async () => {
        await loadGatewaySettings();
        setGatewaySettingsError(null);
      },
      onError: async () => {
        await loadGatewaySettings();
      },
    });

    setRestartingGateway(false);
  }, [capabilities.configWrite, gateway, gatewaySettingsHash, hasActiveGateway, loadGatewaySettings, patchWithRestart, t]);

  return {
    heartbeatEvery,
    setHeartbeatEvery,
    heartbeatActiveStart,
    setHeartbeatActiveStart,
    heartbeatActiveEnd,
    setHeartbeatActiveEnd,
    heartbeatActiveTimezone,
    setHeartbeatActiveTimezone,
    heartbeatSession,
    setHeartbeatSession,
    heartbeatModel,
    setHeartbeatModel,
    defaultModel,
    setDefaultModel,
    fallbackModels,
    setFallbackModels,
    thinkingDefault,
    setThinkingDefault,
    gatewayInfo,
    gatewayUpdateInfo,
    supportsRuntimeSettings: capabilities.configRead,
    supportsRuntimeSettingsWrite: capabilities.configWrite,
    supportsModelSelection: capabilities.modelSelection,
    availableModels,
    loadingGatewaySettings,
    savingGatewaySettings,
    restartingGateway,
    gatewaySettingsError,
    loadGatewaySettings,
    saveGatewaySettings,
    restartGateway,
  };
}
