import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Directory, File, FileMode, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { Download, FileText, ImageIcon, RotateCcw, Share2 } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import type { ArtifactOperations, ChatMessage } from '@clawket/agent-protocol';
import { receiveSessionFile, validateSessionFiles } from '../../services/session-files';
import { MessageAttachmentAlbum } from './MessageAttachmentAlbum';
import { BorderWidth, ControlSize, FontSize, FontWeight, IconSize, LineHeight, Radius, Space } from '../../theme/tokens';
import { useAppTheme } from '../../theme';
import { useChatSurfaces } from './ChatPresentation';

type Downloaded = { uri: string; mimeType: string; name: string; size: number };
let scopeSequence = 0;
type Scope = { id: number; retain: (uri: string) => void; load: (id: string) => Promise<Downloaded>; active: boolean };
const Context = createContext<Scope | null>(null);
const remove = (directory: Directory) => { try { directory.delete(); } catch { /* OS may already have pruned cache. */ } };

/** Session-scoped, serialized downloads. Only stable attachment references enter chat history. */
export function ArtifactProvider({ operations, sessionKey, children }: React.PropsWithChildren<{ operations?: ArtifactOperations; sessionKey?: string | null }>): React.JSX.Element {
  const [current, setCurrent] = useState<{ scope: Scope; operations?: ArtifactOperations; sessionKey?: string | null } | null>(null);
  useEffect(() => {
    const abort = new AbortController();
    const completed = new Map<string, Promise<Downloaded>>();
    const directories = new Set<Directory>();
    const retained = new Set<string>();
    let total = 0;
    let queue: Promise<unknown> = Promise.resolve();
    const check = () => { if (abort.signal.aborted || !operations || !sessionKey) throw new Error('unavailable'); };
    const value = {
      id: ++scopeSequence,
      retain: (uri: string) => { retained.add(uri); },
      active: true,
      load: (id: string): Promise<Downloaded> => {
        const existing = completed.get(id); if (existing) return existing;
        const task = queue.catch(() => {}).then(async () => {
          check();
          const item = await operations!.open(sessionKey!, id); check();
          validateSessionFiles({ files: [item] });
          if (total + item.size > 30 * 1024 * 1024 || directories.size >= 16) throw new Error('unavailable');
          const root = new Directory(Paths.cache, 'artifact-downloads'); root.create({ intermediates: true, idempotent: true });
          for (const old of root.list()) if (old instanceof Directory && /^transfer-\d+-[a-z0-9]+$/.test(old.name)
            && Date.now() - Number(old.name.split('-')[1]) > 24 * 60 * 60 * 1000) remove(old);
          const cacheSize = root.size;
          if (cacheSize === null || cacheSize + item.size > 100 * 1024 * 1024 || root.list().length >= 128) throw new Error('unavailable');
          const directory = new Directory(root, `transfer-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`);
          directory.create(); directories.add(directory);
          try {
            const file = new File(directory, item.name); file.create();
            const handle = file.open(FileMode.WriteOnly);
            try { await receiveSessionFile(operations!, sessionKey!, item, abort.signal, bytes => handle.writeBytes(bytes), () => {}); }
            finally { handle.close(); }
            check(); total += item.size;
            return { uri: file.uri, mimeType: item.mimeType, name: item.name, size: item.size };
          } catch (error) { remove(directory); directories.delete(directory); throw error; }
        });
        completed.set(id, task); queue = task;
        void task.catch(() => { if (completed.get(id) === task) completed.delete(id); });
        return task;
      },
      dispose: () => {
        value.active = false; abort.abort(); completed.clear();
        // Android's share recipient may still hold a URI grant; prune those local files after 24h.
        for (const directory of directories) if (Platform.OS !== 'android' || ![...retained].some(uri => uri.startsWith(directory.uri + '/'))) remove(directory);
      },
    };
    setCurrent({ scope: value, operations, sessionKey });
    return () => value.dispose();
  }, [operations, sessionKey]);
  const scope = current?.operations === operations && current?.sessionKey === sessionKey ? current?.scope : null;
  return <Context.Provider value={operations && sessionKey ? scope ?? null : null}>{children}</Context.Provider>;
}

export function ArtifactAttachments({ attachments, onOpenImage, maxWidth }: {
  attachments: NonNullable<ChatMessage['attachments']>;
  maxWidth: number;
  onOpenImage?: (uri: string) => void;
}): React.JSX.Element {
  const scope = useContext(Context);
  return <View>{attachments.map((attachment, index) => attachment.artifactId
    ? <ArtifactAttachment key={`${scope?.id ?? 0}:${attachment.artifactId}:${index}`} attachment={attachment} onOpenImage={onOpenImage} maxWidth={maxWidth} /> : null)}</View>;
}

function ArtifactAttachment({ attachment, onOpenImage, maxWidth }: {
  maxWidth: number; attachment: NonNullable<ChatMessage['attachments']>[number]; onOpenImage?: (uri: string) => void;
}): React.JSX.Element {
  const scope = useContext(Context);
  const { t } = useTranslation('chat'); const { theme } = useAppTheme();
  // A file card sits among the bubbles on the conversation's card color; its
  // glyph well takes the contrasting neutral.
  const surfaces = useChatSurfaces();
  const wellColor = surfaces.card === theme.colors.surface ? theme.colors.canvas : theme.colors.surface;
  const [loaded, setLoaded] = useState<Downloaded | null>(null);
  const [failed, setFailed] = useState(false); const [busy, setBusy] = useState(false);
  const live = useRef(true); const loading = useRef(false);
  const isImage = attachment.type === 'image';
  const load = async (share: boolean) => {
    if (!scope || loading.current) return;
    loading.current = true; setBusy(true); setFailed(false);
    try {
      const file = loaded ?? await scope.load(attachment.artifactId!);
      if (!live.current || !scope.active) return;
      if (isImage) {
        if (!/^image\/(png|jpeg|gif|webp)$/.test(file.mimeType)) throw new Error('unsupported');
        const dimensions = await Image.getSize(file.uri);
        if (!dimensions.width || !dimensions.height || dimensions.width * dimensions.height > 16_000_000) throw new Error('too_large');
      }
      if (!live.current || !scope.active) return;
      setLoaded(file);
      if (share) {
        if (!await Sharing.isAvailableAsync()) throw new Error('unavailable');
        if (live.current && scope.active) { scope.retain(file.uri); await Sharing.shareAsync(file.uri, { mimeType: file.mimeType }); }
      }
    } catch { if (live.current && scope?.active) setFailed(true); }
    finally { loading.current = false; if (live.current) setBusy(false); }
  };
  useEffect(() => {
    live.current = true; setLoaded(null); setFailed(false);
    if (isImage) void load(false);
    return () => { live.current = false; };
    // Scope and artifact identity own all asynchronous results.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope, attachment.artifactId]);
  const name = loaded?.name || attachment.name || (isImage ? t('Image', { ns: 'settings' }) : t('File'));
  const extension = name.match(/\.([a-z0-9]{1,8})$/i)?.[1]?.toUpperCase();
  const detail = [extension || (isImage ? t('Image', { ns: 'settings' }) : t('File')),
    loaded ? formatSize(loaded.size) : null].filter(Boolean).join(' · ');
  const action = failed ? t('Retry') : loaded ? t('Share') : t('Download attachment');
  const Icon = isImage ? ImageIcon : FileText;
  const ActionIcon = failed ? RotateCcw : loaded ? Share2 : Download;
  return <View testID="thread-artifact" style={styles.container}>
    {loaded && isImage ? <MessageAttachmentAlbum uris={[loaded.uri]} maxWidth={maxWidth} align="start" label={name}
      testID="artifact-album" formatTileLabel={() => name} onPressImage={() => onOpenImage?.(loaded.uri)} />
      : <Pressable testID="artifact-file-card" accessibilityRole="button" accessibilityLabel={`${name}, ${busy ? t('Downloading attachment') : action}`}
        accessibilityState={{ disabled: !scope || busy, busy }} disabled={!scope || busy}
        onPress={() => { void load(!isImage); }}
        style={({ pressed }) => [styles.card, { width: maxWidth, backgroundColor: surfaces.card,
          borderColor: theme.colors.line, opacity: pressed ? 0.7 : 1 }]}>
        <View style={[styles.fileIcon, { backgroundColor: wellColor }]}><Icon size={IconSize.lg} color={theme.colors.inkSecondary} strokeWidth={1.6} /></View>
        <View style={styles.fileInfo}>
          <Text numberOfLines={2} style={[styles.name, { color: theme.colors.ink }]}>{name}</Text>
          <Text numberOfLines={1} style={[styles.detail, { color: failed ? theme.colors.bad : theme.colors.inkSecondary }]}>
            {failed ? t('Could not retrieve files') : busy ? t('Downloading attachment') : detail}
          </Text>
        </View>
        <View style={styles.action}>
          {busy ? <ActivityIndicator color={theme.colors.inkSecondary} /> : <ActionIcon size={IconSize.md} color={theme.colors.ink} />}
          {!busy ? <Text style={[styles.actionText, { color: theme.colors.inkSecondary }]}>{action}</Text> : null}
        </View>
      </Pressable>}
  </View>;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create({
  container: { paddingVertical: Space.xs },
  card: { flexDirection: 'row', alignItems: 'center', gap: Space.md, padding: Space.md,
    borderRadius: Radius.card, borderWidth: BorderWidth.hairline },
  fileIcon: { width: ControlSize.floatingButton, height: ControlSize.floatingButton, borderRadius: Radius.settingsGroup, alignItems: 'center', justifyContent: 'center' },
  fileInfo: { flex: 1, gap: Space.xs },
  name: { fontSize: FontSize.secondary, lineHeight: LineHeight.secondary, fontWeight: FontWeight.semibold },
  detail: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
  action: { minWidth: ControlSize.floatingButton, minHeight: ControlSize.floatingButton, justifyContent: 'center', alignItems: 'center', gap: Space.xs },
  actionText: { fontSize: FontSize.caption, lineHeight: LineHeight.caption },
});
