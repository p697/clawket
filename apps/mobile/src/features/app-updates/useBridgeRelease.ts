import { useCallback, useEffect, useState, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { BRIDGE_RELEASE_URL, parseRelease, type BridgeRelease } from './bridge-release';
const KEY = 'clawket.bridgeRelease.v1', DAY = 24 * 60 * 60 * 1000;
export function useBridgeRelease(enabled: boolean) {
  const request = useRef<AbortController | null>(null);
  const [release, setRelease] = useState<BridgeRelease | null>(null);
  const [checking, setChecking] = useState(false);
  const [failed, setFailed] = useState(false);
  const refresh = useCallback(async () => {
    request.current?.abort();
    setChecking(true); setFailed(false);
    const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 10_000);
    request.current = controller;
    try {
      const response = await fetch(BRIDGE_RELEASE_URL, { signal: controller.signal });
      if (!response.ok) throw new Error();
      const raw = await response.text(); if (raw.length > 128 * 1024) throw new Error();
      const next = parseRelease(JSON.parse(raw), Date.now()); if (!next) throw new Error();
      if (request.current !== controller) return;
      setRelease(next); await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => undefined);
    } catch { if (request.current === controller) setFailed(true); } finally { clearTimeout(timer); if (request.current === controller) { request.current = null; setChecking(false); } }
  }, []);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    void AsyncStorage.getItem(KEY).catch(() => null).then(raw => {
      if (!active) return;
      let cached: BridgeRelease | null = null;
      try { const value = JSON.parse(raw ?? 'null'); cached = parseRelease({ name: '@p697/clawket', version: value?.version, clawket: { updateProtocol: value?.unifiedUpdate === true ? 1 : 0 } }, value?.checkedAt); } catch { /* Invalid cache requires a new check. */ }
      if (cached && Number.isFinite(cached.checkedAt) && cached.checkedAt <= Date.now()) setRelease(cached); else cached = null;
      if (!cached || Date.now() - cached.checkedAt >= DAY) void refresh();
    });
    return () => { active = false; request.current?.abort(); request.current = null; };
  }, [enabled, refresh]);
  return { release, checking, failed, refresh };
}
