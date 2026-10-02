import React, { createContext, useCallback, useContext, useMemo, useRef, useSyncExternalStore } from 'react';
import { Pressable, StyleSheet, Text, View, type StyleProp, type TextStyle, type TextLayoutEventData, type NativeSyntheticEvent } from 'react-native';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { useTranslation } from 'react-i18next';
import { ControlSize, FontSize, FontWeight, LineHeight, Space } from '../../theme/tokens';

export const USER_MESSAGE_PREVIEW_LINES = 6;
type Measurement = Readonly<{ text: string; width: number; fontSize: number; fontScale: number }>;
type Disclosure = Measurement & Readonly<{ long: boolean; expanded: boolean }>;
const UNMEASURED = null;

function sameMeasurement(a: Measurement | null | undefined, b: Measurement): boolean {
  return Boolean(a && a.text === b.text && a.width === b.width && a.fontSize === b.fontSize && a.fontScale === b.fontScale);
}

/** Conversation-owned state, with subscriptions per row so measuring history does not redraw the list. */
function createDisclosureStore() {
  const entries = new Map<string, Disclosure>();
  const listeners = new Map<string, Set<() => void>>();
  return {
    read: (id: string) => entries.get(id),
    subscribe(id: string, listener: () => void) {
      const row = listeners.get(id) ?? new Set();
      row.add(listener);
      listeners.set(id, row);
      return () => { row.delete(listener); if (!row.size) listeners.delete(id); };
    },
    write(id: string, entry: Disclosure) {
      const previous = entries.get(id);
      if (sameMeasurement(previous, entry) && previous?.long === entry.long && previous.expanded === entry.expanded) return;
      entries.set(id, entry);
      listeners.get(id)?.forEach(listener => listener());
    },
  };
}
type DisclosureStore = ReturnType<typeof createDisclosureStore>;
const DisclosureContext = createContext<{ store: DisclosureStore; onToggle: () => void } | null>(null);

export function UserMessageDisclosureProvider({ scope, onToggle, children }: Readonly<{
  scope: string; onToggle: () => void; children: React.ReactNode;
}>): React.JSX.Element {
  const store = useMemo(createDisclosureStore, [scope]);
  const value = useMemo(() => ({ store, onToggle }), [store, onToggle]);
  return <DisclosureContext.Provider value={value}>{children}</DisclosureContext.Provider>;
}

/** An offscreen seven-line native Text detects overflow even on platforms that report only clamped lines. */
export function UserMessageText({ id, text, width, fontSize, fontScale, color, textStyle, selectable = false, meta, metaSpacer, onLongPress }: Readonly<{
  id: string;
  text: string;
  /** Maximum bubble content width; independent of the short bubble's intrinsic width. */
  width: number;
  fontSize: number;
  fontScale: number;
  color: string;
  textStyle: StyleProp<TextStyle>;
  selectable?: boolean;
  meta?: React.ReactNode;
  metaSpacer?: React.ReactNode;
  onLongPress?: () => void;
}>): React.JSX.Element {
  const context = useContext(DisclosureContext);
  const fallbackStore = useMemo(createDisclosureStore, []);
  const store = context?.store ?? fallbackStore;
  const { t } = useTranslation('chat');
  const measurement = useMemo(() => ({ text, width, fontSize, fontScale }), [text, width, fontSize, fontScale]);
  const currentMeasurement = useRef(measurement);
  currentMeasurement.current = measurement;
  const subscribe = useCallback((listener: () => void) => store.subscribe(id, listener), [id, store]);
  const getSnapshot = useCallback(() => {
    const entry = store.read(id);
    return sameMeasurement(entry, measurement) ? entry! : UNMEASURED;
  }, [id, measurement, store]);
  const disclosure = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const previous = store.read(id);
  const current = disclosure ?? (previous?.text === text ? previous : null);
  const long = current?.long ?? false;
  const expanded = long && current?.expanded === true;
  const measure = useCallback((event: NativeSyntheticEvent<TextLayoutEventData>) => {
    if (currentMeasurement.current !== measurement || !event.nativeEvent.lines.length) return;
    const previous = store.read(id);
    store.write(id, {
      ...measurement,
      long: event.nativeEvent.lines.length > USER_MESSAGE_PREVIEW_LINES,
      expanded: previous?.text === text && previous.expanded,
    });
  }, [id, measurement, store, text]);
  const toggle = () => {
    if (!disclosure) return;
    context?.onToggle();
    store.write(id, { ...disclosure, expanded: !expanded });
  };
  const Icon = expanded ? ChevronUp : ChevronDown;
  const label = expanded ? t('Collapse message') : t('Expand message');
  return (
    <View style={[styles.body, long ? { width } : null]}>
      <Text testID={`user-message-text-${id}`} selectable={selectable} style={textStyle}
        accessibilityActions={onLongPress ? [{ name: 'longpress' }] : undefined}
        onAccessibilityAction={onLongPress ? event => { if (event.nativeEvent.actionName === 'longpress') onLongPress(); } : undefined}
        textBreakStrategy="simple" numberOfLines={expanded || disclosure?.long === false ? undefined : USER_MESSAGE_PREVIEW_LINES} ellipsizeMode="tail">
        {text}{long ? null : metaSpacer}
      </Text>
      <Text testID={`user-message-measure-${id}`} accessible={false} accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants" pointerEvents="none"
        style={[textStyle, styles.measurement, { width }]} textBreakStrategy="simple"
        numberOfLines={USER_MESSAGE_PREVIEW_LINES + 1} onTextLayout={measure}>{text}</Text>
      {long ? (
        <View testID={`user-message-footer-${id}`} style={styles.footer}>
          <Pressable testID={`user-message-toggle-${id}`} accessibilityRole="button" accessibilityLabel={label}
            accessibilityState={{ expanded, disabled: selectable }} disabled={selectable}
            onPress={event => { event.stopPropagation(); toggle(); }} onLongPress={onLongPress}
            style={({ pressed }) => [styles.toggle, { opacity: pressed ? 0.65 : 1 }]}>
            <Text style={[styles.label, { color }]}>{label}</Text>
            <Icon size={14} color={color} strokeWidth={1.75} />
          </Pressable>
          {meta ? <View style={styles.footerMeta}>{meta}</View> : null}
        </View>
      ) : meta ? <View style={styles.metaOverlay}>{meta}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  body: { position: 'relative' },
  measurement: { position: 'absolute', top: 0, left: 0, opacity: 0 },
  footer: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', columnGap: Space.sm },
  toggle: { minHeight: ControlSize.floatingButton, minWidth: ControlSize.floatingButton, flexDirection: 'row', alignItems: 'center', gap: Space.xs, flexShrink: 1 },
  label: { fontSize: FontSize.caption, lineHeight: LineHeight.caption, fontWeight: FontWeight.semibold, flexShrink: 1 },
  footerMeta: { marginStart: 'auto', paddingVertical: Space.xs },
  metaOverlay: { position: 'absolute', right: 0, bottom: 0 },
});
