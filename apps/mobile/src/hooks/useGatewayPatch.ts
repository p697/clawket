import { useCallback } from 'react';
import { Alert } from 'react-native';
import { useTranslation } from 'react-i18next';
import type { GatewayClient } from '../connection/protocol';
import { useGatewayOverlay } from '../contexts/GatewayOverlayContext';

const GATEWAY_READY_TIMEOUT_MS = 15_000;

type PatchResult = {
  ok: boolean;
  config?: Record<string, unknown>;
  hash?: string;
  path?: string;
};

type BaseMutationOptions = {
  /** Current config hash for optimistic-concurrency control. */
  configHash: string;
  /** Require an explicit confirmation before saving. */
  confirmation?:
    | boolean
    | {
      title?: string;
      message?: string;
      confirmText?: string;
      cancelText?: string;
    };
  /** Overlay text while the request is in flight. */
  savingMessage?: string;
  /** Overlay text while waiting for gateway restart/readiness. */
  restartingMessage?: string;
  /** Called after gateway reconnects with the patchConfig result. Use for data refresh. */
  onSuccess?: (result: PatchResult) => Promise<void> | void;
  /** Called on failure before the Alert is shown. Use for rollback / reload. */
  onError?: (error: unknown) => Promise<void> | void;
  /** Error Alert title. Defaults to "Save Failed". */
  errorTitle?: string;
};

type PatchOptions = BaseMutationOptions & {
  /** JSON-serialisable merge-patch object. */
  patch: Record<string, unknown>;
};

type SetOptions = BaseMutationOptions & {
  /** Full config object to replace the current gateway config. */
  config: Record<string, unknown>;
};

function confirmPatchAction(
  options: Exclude<PatchOptions['confirmation'], boolean | undefined>,
  defaults: {
    title: string;
    message: string;
    confirmText: string;
    cancelText: string;
  },
): Promise<boolean> {
  return new Promise((resolve) => {
    Alert.alert(
      options.title ?? defaults.title,
      options.message ?? defaults.message,
      [
        {
          text: options.cancelText ?? defaults.cancelText,
          style: 'cancel',
          onPress: () => resolve(false),
        },
        {
          text: options.confirmText ?? defaults.confirmText,
          style: 'default',
          onPress: () => resolve(true),
        },
      ],
      {
        cancelable: true,
        onDismiss: () => resolve(false),
      },
    );
  });
}

function waitForGatewayReady(gateway: GatewayClient): Promise<void> {
  return new Promise((resolve) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (!settled) { settled = true; off(); resolve(); }
    }, GATEWAY_READY_TIMEOUT_MS);
    const off = gateway.on('connection', ({ state: connState }) => {
      if (connState === 'ready' && !settled) {
        settled = true;
        clearTimeout(timeout);
        off();
        resolve();
      }
    });
  });
}

async function waitForGatewayStable(gateway: GatewayClient): Promise<void> {
  await waitForGatewayReady(gateway);
  if (typeof gateway.probeConnection !== 'function') {
    return;
  }
  try {
    await gateway.probeConnection(GATEWAY_READY_TIMEOUT_MS);
  } catch {
    // The reconnect path is already handled inside probeConnection.
  }
}

/**
 * Hook that wraps gateway config patching with a global full-screen loading overlay
 * and automatic wait-for-restart logic.
 *
 * The overlay is rendered at the App root via GatewayOverlayProvider.
 */
export function useGatewayPatch(gateway: GatewayClient) {
  const { t } = useTranslation('common');
  const {
    showOverlay,
    hideOverlay,
    beginExpectedRestart,
    endExpectedRestart,
  } = useGatewayOverlay();

  const mutateWithRestart = useCallback(async (
    opts: PatchOptions | SetOptions,
    mode: 'patch' | 'set',
  ) => {
    if (opts.confirmation) {
      const confirmed = await confirmPatchAction(
        typeof opts.confirmation === 'object' ? opts.confirmation : {},
        {
          title: t('Confirm Save'),
          message: t('This will restart Gateway. Continue?'),
          confirmText: t('Save'),
          cancelText: t('Cancel'),
        },
      );
      if (!confirmed) {
        return false;
      }
    }

    showOverlay(opts.savingMessage ?? t('Saving settings...'));
    let expectedRestartStarted = false;
    try {
      const raw = JSON.stringify(
        mode === 'patch'
          ? (opts as PatchOptions).patch
          : (opts as SetOptions).config,
      );
      const result = mode === 'patch'
        ? await gateway.patchConfig(raw, opts.configHash)
        : await gateway.setConfig(raw, opts.configHash);
      if (!result.ok) throw new Error('Gateway rejected config patch');
      beginExpectedRestart();
      expectedRestartStarted = true;
      showOverlay(opts.restartingMessage ?? t('Restarting Gateway to apply changes...'));
      await waitForGatewayStable(gateway);
      if (opts.onSuccess) await opts.onSuccess(result);
      return true;
    } catch (err: unknown) {
      if (opts.onError) await opts.onError(err);
      const message = err instanceof Error ? err.message : 'Failed to save settings';
      Alert.alert(opts.errorTitle ?? t('Save Failed'), message);
      return false;
    } finally {
      hideOverlay();
      if (expectedRestartStarted) {
        endExpectedRestart();
      }
    }
  }, [t, gateway, showOverlay, hideOverlay, beginExpectedRestart, endExpectedRestart]);

  const patchWithRestart = useCallback(async (opts: PatchOptions) => {
    return mutateWithRestart(opts, 'patch');
  }, [mutateWithRestart]);

  const setWithRestart = useCallback(async (opts: SetOptions) => {
    return mutateWithRestart(opts, 'set');
  }, [mutateWithRestart]);

  return { patchWithRestart, setWithRestart };
}
