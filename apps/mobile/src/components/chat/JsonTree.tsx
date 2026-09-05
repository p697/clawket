import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useAppTheme } from '../../theme';
import { FontSize, Space } from '../../theme/tokens';

type JsonValue = string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };
const MONOSPACE_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });

interface NodeProps {
  value: JsonValue;
  depth: number;
  isLast: boolean;
}

function isPrimitiveJsonValue(value: JsonValue): value is string | number | boolean | null {
  return value === null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';
}

function JsonPrimitive({ value, isLast }: { value: string | number | boolean | null; isLast: boolean }): React.JSX.Element {
  const { theme } = useAppTheme();
  const c = theme.colors;

  if (value === null) {
    return <Text style={[s.value, { color: c.inkTertiary }]}>null{isLast ? '' : ','}</Text>;
  }
  if (typeof value === 'boolean') {
    return <Text style={[s.value, { color: c.warn }]}>{String(value)}{isLast ? '' : ','}</Text>;
  }
  if (typeof value === 'number') {
    return <Text style={[s.value, { color: c.warn }]}>{value}{isLast ? '' : ','}</Text>;
  }
  return <Text style={[s.value, { color: c.good }]}>&quot;{value}&quot;{isLast ? '' : ','}</Text>;
}

function JsonNode({ value, depth, isLast }: NodeProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [collapsed, setCollapsed] = useState(depth >= 2);

  const indent = depth * Space.md;

  if (isPrimitiveJsonValue(value)) {
    return <JsonPrimitive value={value} isLast={isLast} />;
  }

  const isArray = Array.isArray(value);
  const entries = isArray
    ? (value as JsonValue[]).map((v, i) => ({ key: String(i), val: v }))
    : Object.entries(value as Record<string, JsonValue>).map(([k, v]) => ({ key: k, val: v }));

  const open = isArray ? '[' : '{';
  const close = isArray ? ']' : '}';
  const count = entries.length;

  if (count === 0) {
    return <Text style={[s.value, { color: c.inkSecondary }]}>{open}{close}{isLast ? '' : ','}</Text>;
  }

  return (
    <View>
      <Pressable onPress={() => setCollapsed(v => !v)} style={s.row}>
        <Text style={[s.bracket, { color: c.inkSecondary, paddingLeft: indent }]}>
          {collapsed ? '▶ ' : '▼ '}{open}
          {collapsed ? <Text style={{ color: c.inkTertiary }}> {count} item{count !== 1 ? 's' : ''} </Text> : null}
          {collapsed ? close : null}
          {isLast || collapsed ? '' : ''}
        </Text>
      </Pressable>
      {!collapsed && (
        <View>
          {entries.map(({ key, val }, i) => (
            !isArray && isPrimitiveJsonValue(val) ? (
              <View key={key} style={{ paddingLeft: indent + 12 }}>
                <Text style={s.line}>
                  <Text style={[s.key, { color: c.accent }]}>&quot;{key}&quot;: </Text>
                  <JsonPrimitive value={val} isLast={i === count - 1} />
                </Text>
              </View>
            ) : (
              <View key={key} style={[s.row, { paddingLeft: indent + 12 }]}>
                {!isArray && (
                  <Text style={[s.key, { color: c.accent }]}>&quot;{key}&quot;: </Text>
                )}
                <JsonNode value={val} depth={depth + 1} isLast={i === count - 1} />
              </View>
            )
          ))}
          <Text style={[s.bracket, { color: c.inkSecondary, paddingLeft: indent }]}>
            {close}{isLast ? '' : ','}
          </Text>
        </View>
      )}
    </View>
  );
}

interface JsonTreeProps {
  text: string;
}

export function JsonTree({ text }: JsonTreeProps): React.JSX.Element {
  const { theme } = useAppTheme();
  const c = theme.colors;

  let parsed: JsonValue;
  try {
    parsed = JSON.parse(text);
  } catch {
    return <Text style={[s.fallback, { color: c.inkSecondary }]}>{text}</Text>;
  }

  return (
    <View style={s.container}>
      <JsonNode value={parsed} depth={0} isLast />
    </View>
  );
}

const s = StyleSheet.create({
  container: {
    paddingVertical: Space.xs,
  },
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
  },
  key: {
    fontFamily: MONOSPACE_FONT,
    fontSize: FontSize.caption,
    lineHeight: 20,
  },
  line: {
    fontFamily: MONOSPACE_FONT,
    fontSize: FontSize.caption,
    lineHeight: 20,
  },
  value: {
    fontFamily: MONOSPACE_FONT,
    fontSize: FontSize.caption,
    lineHeight: 20,
    flexShrink: 1,
  },
  bracket: {
    fontFamily: MONOSPACE_FONT,
    fontSize: FontSize.caption,
    lineHeight: 20,
  },
  fallback: {
    fontFamily: MONOSPACE_FONT,
    fontSize: FontSize.caption,
    lineHeight: 18,
  },
});
