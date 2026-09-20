import React, { useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { ChevronDown } from 'lucide-react-native';
import { ChevronRight } from '../ui/DirectionalIcon';
import { useTranslation } from 'react-i18next';
import { useAppTheme } from '../../theme';
import { ControlSize, FontSize, IconSize, LineHeight, Space } from '../../theme/tokens';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const MONOSPACE_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

function JsonNode({ value, depth = 0, label, comma = false }: {
  value: JsonValue; depth?: number; label?: string; comma?: boolean;
}): React.JSX.Element {
  const { theme } = useAppTheme();
  const { t } = useTranslation('chat');
  const c = theme.colors;
  const [collapsed, setCollapsed] = useState(depth >= 2);
  const [count, setCount] = useState(50);
  const prefix = label === undefined ? '' : `${JSON.stringify(label)}: `;
  const suffix = comma ? ',' : '';
  if (value === null || typeof value !== 'object') {
    return <Text selectable style={[s.text, { color: c.ink }]}>
      {prefix}<Text style={{ color: typeof value === 'string' ? c.good : c.inkSecondary }}>{JSON.stringify(value)}</Text>{suffix}
    </Text>;
  }
  const array = Array.isArray(value);
  const open = array ? '[' : '{';
  const close = array ? ']' : '}';
  const entries = Object.entries(value);
  if (!entries.length) return <Text selectable style={[s.text, { color: c.ink }]}>{prefix}{open}{close}{suffix}</Text>;
  const heading = <Text style={[s.text, { color: c.inkSecondary, flex: 1 }]}>{prefix}{open}{collapsed ? ` … ${close}${suffix}` : ''}</Text>;
  return <View>
    {depth === 0 ? heading : <Pressable accessibilityRole="button" accessibilityState={{ expanded: !collapsed }}
      accessibilityLabel={collapsed ? t('Expand JSON') : t('Collapse JSON')}
      onPress={() => setCollapsed(v => !v)} style={s.toggle}>
      {heading}{collapsed ? <ChevronRight size={IconSize.sm} color={c.inkSecondary} /> : <ChevronDown size={IconSize.sm} color={c.inkSecondary} />}
    </Pressable>}
    {!collapsed ? <>
      <View style={s.children}>
        {entries.slice(0, count).map(([key, child], index) => <JsonNode key={key} value={child}
          depth={depth + 1} label={array ? undefined : key} comma={index < entries.length - 1} />)}
        {entries.length > count ? <Pressable accessibilityRole="button" onPress={() => setCount(n => n + 50)} style={s.toggle}>
          <Text style={[s.text, { color: c.inkSecondary }]}>{t('Show more')}</Text>
        </Pressable> : null}
      </View>
      <Text style={[s.text, { color: c.inkSecondary }]}>{close}{suffix}</Text>
    </> : null}
  </View>;
}

export function JsonTree({ text }: { text: string }): React.JSX.Element {
  const { theme } = useAppTheme();
  const parsed = useMemo(() => {
    try { return { ok: true as const, value: JSON.parse(text) as JsonValue }; }
    catch { return { ok: false as const }; }
  }, [text]);
  return parsed.ok ? <JsonNode value={parsed.value} /> : <Text selectable style={[s.text, { color: theme.colors.ink }]}>{text}</Text>;
}

/** The same tree for an already-parsed JSON value (config sections): nodes two levels down start collapsed. */
export function JsonValueTree({ value }: { value: unknown }): React.JSX.Element {
  return <JsonNode value={value as JsonValue} />;
}
const s = StyleSheet.create({
  text: { fontFamily: MONOSPACE_FONT, fontSize: FontSize.caption, lineHeight: LineHeight.secondary },
  children: { paddingLeft: Space.md },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: Space.sm, minHeight: ControlSize.floatingButton },
});
