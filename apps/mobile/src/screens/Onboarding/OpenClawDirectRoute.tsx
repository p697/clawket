import React, { useCallback, useRef, useState } from 'react';
import { Keyboard } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import * as Clipboard from 'expo-clipboard';
import { getConnectionRuntime, useConnections, connectOpenClawDirect, buildOpenClawDirectRecord,
  DirectConnectionInputError, classifyOpenClawDirectFailure, findOpenClawDirectConnection, type OpenClawDirectDraft } from '../../connection';
import { useProPaywall } from '../../contexts/ProPaywallContext';
import type { RootStackParamList } from '../../navigation/root-stack';
import type { OnboardingConnectedResult } from './OnboardingRoute';
import { OpenClawDirectScreen, type OpenClawDirectScreenProps } from './OpenClawDirectScreen';

type Props = NativeStackScreenProps<RootStackParamList, 'OpenClawDirect'> & {
  onConnected: (result: OnboardingConnectedResult) => void;
  onOpenPaywall: (reason: 'gatewayConnections', onContinue?: () => void) => void;
};
export function OpenClawDirectRoute({ navigation, onConnected, onOpenPaywall }: Props) {
  const runtime = useConnections();
  const { isPro } = useProPaywall();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<OpenClawDirectScreenProps['error']>();
  const generation = useRef(0);
  const focused = useRef(false);
  const inFlight = useRef<number | null>(null);
  const target = useRef<string | undefined>(undefined);
  const retryId = useRef<string | undefined>(undefined);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retire = useCallback(() => {
    ++generation.current;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const id = target.current;
    target.current = undefined;
    if (id && getConnectionRuntime().getSnapshot().activeConnectionId === id) {
      void getConnectionRuntime().pauseConnection(id).catch(() => {});
    }
  }, []);
  useFocusEffect(useCallback(() => {
    focused.current = true;
    return () => { focused.current = false; retire(); };
  }, [retire]));

  const submit = useCallback((draft: OpenClawDirectDraft) => {
    if (inFlight.current !== null || !focused.current) return;
    try { buildOpenClawDirectRecord(draft); } catch (failure) {
      setError(failure instanceof DirectConnectionInputError ? failure.field : 'url');
      return;
    }
    const current = ++generation.current;
    const connect = async () => {
      if (!focused.current || current !== generation.current || inFlight.current !== null) return;
      inFlight.current = current;
      setBusy(true); setError(undefined); Keyboard.dismiss();
      const isCurrent = () => focused.current && current === generation.current;
      timer.current = setTimeout(() => {
        if (!isCurrent()) return;
        retire(); inFlight.current = null; setBusy(false); setError('network');
      }, 30_000);
      try {
        const coordinator = getConnectionRuntime();
        const connection = await connectOpenClawDirect({
          runtime: coordinator, draft, retryConnectionId: retryId.current, isCurrent,
          onSaved: (saved) => { target.current = saved.id; retryId.current = saved.id; },
        });
        if (!isCurrent() || !connection) return;
        const snapshot = coordinator.getSnapshot();
        if (snapshot.activeConnectionId === connection.id && snapshot.activeState === 'ready') {
          // A completed Gateway handshake is required; a raw websocket open cannot finish setup.
          target.current = undefined;
          onConnected({ connectionId: connection.id, backendKind: 'openclaw' });
        } else {
          setError(classifyOpenClawDirectFailure(snapshot.error));
        }
      } catch (failure) {
        if (isCurrent()) {
          setError(failure instanceof DirectConnectionInputError ? failure.field : classifyOpenClawDirectFailure(failure));
        }
      } finally {
        if (inFlight.current === current) inFlight.current = null;
        if (isCurrent()) { if (timer.current) clearTimeout(timer.current); timer.current = null; setBusy(false); }
      }
    };
    if (runtime.connections.length > 0 && !isPro && !retryId.current) {
      // Reopening a failed free connection is a retry, not an additional Pro connection.
      inFlight.current = current; setBusy(true);
      void (async () => {
        let existing;
        try {
          existing = await findOpenClawDirectConnection({ runtime: getConnectionRuntime(), url: draft.url,
            isCurrent: () => focused.current && current === generation.current });
        } catch {
          if (focused.current && current === generation.current) setError('server');
          return;
        } finally {
          if (inFlight.current === current) inFlight.current = null;
          if (focused.current && current === generation.current) setBusy(false);
        }
        if (!focused.current || current !== generation.current) return;
        if (existing?.isFreeSlot) { retryId.current = existing.id; await connect(); }
        else onOpenPaywall('gatewayConnections', () => { void connect(); });
      })();
    } else { void connect(); }
  }, [isPro, onConnected, onOpenPaywall, retire, runtime.connections.length]);

  return <OpenClawDirectScreen busy={busy} error={error} onSubmit={submit}
    onBack={() => { retire(); navigation.goBack(); }}
    onDraftChanged={() => { if (inFlight.current === null) retire(); }}
    onCopyCommand={(command) => { void Clipboard.setStringAsync(command).catch(() => setError('server')); }} />;
}
