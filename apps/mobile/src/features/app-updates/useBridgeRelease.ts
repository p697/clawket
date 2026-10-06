import { useCallback, useEffect, useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BRIDGE_RELEASE_URL, parseRelease, type BridgeRelease } from './bridge-release';
const KEY = 'clawket.bridgeRelease.v1';
/**
 * npm's latest release is checked live at launch and whenever Settings or the Bridge guide opens
 * (owner decision 2026-10-06). The saved result only covers the wait and failed checks.
 */
export function useBridgeRelease(enabled: boolean) {
  const request = useRef<{ controller: AbortController; done: Promise<void> } | null>(null);
  const checked = useRef(false);
  const [release, setRelease] = useState<BridgeRelease | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback((): Promise<void> => {
    // Opening Settings and then the guide must not start a second request.
    if (request.current) return request.current.done;
    setChecking(true); setFailed(false);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
    const done = (async () => {
      try {
        const response = await fetch(BRIDGE_RELEASE_URL, { signal: controller.signal });
        if (!response.ok) throw new Error();
        const raw = await response.text(); if (raw.length > 128 * 1024) throw new Error();
        const next = parseRelease(JSON.parse(raw), Date.now()); if (!next) throw new Error();
        if (request.current?.controller !== controller) return;
        checked.current = true; setRelease(next); await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
      } catch { if (request.current?.controller === controller) setFailed(true); } finally { clearTimeout(timer); if (request.current?.controller === controller) { request.current = null; setChecking(false); } }
    })();
    request.current = { controller, done };
    return done;
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void AsyncStorage.getItem(KEY).catch(() => null).then(raw => {
      if (!active) return;
      let cached: BridgeRelease | null = null;
      try { const value = JSON.parse(raw ?? 'null'); cached = parseRelease({ name: '@p697/clawket', version: value?.version, clawket: { updateProtocol: value?.unifiedUpdate === true ? 1 : 0 } }, value?.checkedAt); } catch { /* Invalid cache waits for the live check. */ }
      // A live answer that already arrived is never replaced by the saved one.
      if (cached && Number.isFinite(cached.checkedAt) && cached.checkedAt <= Date.now() && !checked.current) setRelease(cached);
      void refresh();
    });
    return () => { active = false; request.current?.controller.abort(); request.current = null; };
  }, [enabled, refresh]);
  return { release, checking, failed, refresh };
}
