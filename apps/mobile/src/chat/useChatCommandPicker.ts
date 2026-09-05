import { useCallback, useMemo, useRef, useState } from 'react';
import { ConnectionState } from '../types';

export type CommandPickerKind = 'think' | 'reasoning' | 'fast';

export type CommandPickerOption = {
  value: string;
  isCurrent: boolean;
};

const COMMAND_PICKER_CONFIG: Record<CommandPickerKind, { probeCommand: string }> = {
  think: { probeCommand: '/think' },
  reasoning: { probeCommand: '/reasoning' },
  // `/fast` is handled by OpenClaw as a text command and does not include options.
  // Probe `/fast:` so the inline-directive path returns the selectable options list.
  fast: { probeCommand: '/fast:' },
};

function parseCommandOptionsFromText(text: string): { current: string | null; options: string[] } {
  const normalized = text.replace(/\r\n/g, '\n');
  const currentMatch = normalized.match(/Current\s+[a-z\s_-]*(?:level|mode):\s*([^\n.]+)/i);
  const optionsMatch = normalized.match(/Options:\s*([^\n]+)/i);
  const current = currentMatch?.[1]?.replace(/\s*\([^)]*\)\s*$/, '').trim() ?? null;
  const optionsRaw = (optionsMatch?.[1] ?? '').replace(/[.。]\s*$/, '').trim();
  const options = optionsRaw
    .split(/[,\|]/)
    .map((item) => item.trim())
    .filter(Boolean);
  return {
    current,
    options: Array.from(new Set(options)),
  };
}

type Props = {
  connectionState: ConnectionState;
  runSilentCommandProbe: (commandText: string) => Promise<string>;
  sessionKey: string | null;
  setInput: (value: string) => void;
  setThinkingLevel: (value: string | null) => void;
  submitMessage: (text: string, images: []) => Promise<boolean> | boolean | void;
  t: (key: string, options?: Record<string, unknown>) => string;
};

function translateCommandPickerTitle(
  kind: CommandPickerKind | null,
  t: Props['t'],
): string {
  if (kind === 'think') return t('Thinking', { ns: 'chat' });
  if (kind === 'reasoning') return t('Reasoning', { ns: 'chat' });
  if (kind === 'fast') return t('Fast', { ns: 'chat' });
  return t('Options', { ns: 'chat' });
}

export function useChatCommandPicker({
  connectionState,
  runSilentCommandProbe,
  sessionKey,
  setInput,
  setThinkingLevel,
  submitMessage,
  t,
}: Props) {
  const [commandPickerVisible, setCommandPickerVisible] = useState(false);
  const [commandPickerKind, setCommandPickerKind] = useState<CommandPickerKind | null>(null);
  const [commandPickerLoading, setCommandPickerLoading] = useState(false);
  const [commandPickerError, setCommandPickerError] = useState<string | null>(null);
  const [commandPickerOptions, setCommandPickerOptions] = useState<CommandPickerOption[]>([]);
  const commandPickerRequestIdRef = useRef(0);

  const loadCommandPickerOptions = useCallback(async (kind: CommandPickerKind) => {
    if (connectionState !== 'ready' || !sessionKey) {
      setCommandPickerError(t('Gateway is not connected', { ns: 'chat' }));
      setCommandPickerOptions([]);
      setCommandPickerLoading(false);
      return;
    }

    const requestId = ++commandPickerRequestIdRef.current;
    setCommandPickerLoading(true);
    setCommandPickerError(null);
    setCommandPickerOptions([]);

    try {
      const probeText = await runSilentCommandProbe(COMMAND_PICKER_CONFIG[kind].probeCommand);
      const parsed = parseCommandOptionsFromText(probeText);
      if (parsed.options.length === 0) {
        throw new Error(t('No options available', { ns: 'chat' }));
      }
      if (commandPickerRequestIdRef.current !== requestId) return;
      setCommandPickerOptions(
        parsed.options.map((value) => ({
          value,
          isCurrent: !!parsed.current && parsed.current.toLowerCase() === value.toLowerCase(),
        })),
      );
    } catch (err: unknown) {
      if (commandPickerRequestIdRef.current !== requestId) return;
      const msg = err instanceof Error ? err.message : String(err);
      setCommandPickerError(msg || t('Failed to load options', { ns: 'chat' }));
      setCommandPickerOptions([]);
    } finally {
      if (commandPickerRequestIdRef.current === requestId) {
        setCommandPickerLoading(false);
      }
    }
  }, [connectionState, runSilentCommandProbe, sessionKey, t]);

  const openCommandPicker = useCallback((kind: CommandPickerKind): boolean => {
    if (connectionState !== 'ready' || !sessionKey) {
      return false;
    }
    setCommandPickerKind(kind);
    setCommandPickerVisible(true);
    void loadCommandPickerOptions(kind);
    return true;
  }, [connectionState, loadCommandPickerOptions, sessionKey]);

  const closeCommandPicker = useCallback(() => {
    commandPickerRequestIdRef.current += 1;
    setCommandPickerVisible(false);
    setCommandPickerKind(null);
    setCommandPickerLoading(false);
    setCommandPickerError(null);
    setCommandPickerOptions([]);
  }, []);

  const retryCommandPickerLoad = useCallback(() => {
    if (!commandPickerKind) return;
    void loadCommandPickerOptions(commandPickerKind);
  }, [commandPickerKind, loadCommandPickerOptions]);

  const onSelectCommandOption = useCallback((option: string) => {
    const command = commandPickerKind;
    const value = option.trim();
    if (!command || !value) return;

    closeCommandPicker();
    const commandText = `/${command} ${value}`;

    if (command === 'think') {
      setThinkingLevel(value);
    }

    if (connectionState !== 'ready' || !sessionKey) {
      setInput(commandText);
      return;
    }

    void Promise.resolve(submitMessage(commandText, [])).then((sent) => {
      if (sent === false) {
        setInput(commandText);
      }
    });
  }, [closeCommandPicker, commandPickerKind, connectionState, sessionKey, setInput, setThinkingLevel, submitMessage]);

  const commandPickerTitle = useMemo(
    () => translateCommandPickerTitle(commandPickerKind, t),
    [commandPickerKind, t],
  );

  return {
    closeCommandPicker,
    commandPickerError,
    commandPickerLoading,
    commandPickerOptions,
    commandPickerTitle,
    commandPickerVisible,
    onSelectCommandOption,
    openCommandPicker,
    retryCommandPickerLoad,
  };
}
