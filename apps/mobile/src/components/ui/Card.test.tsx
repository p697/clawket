import React from 'react';
import { render } from '@testing-library/react-native';
import { StyleSheet, Text, View } from 'react-native';
import { builtInAccents } from '../../theme/accents';
import { buildTheme } from '../../theme/theme';
import { Radius } from '../../theme/tokens';
import { Card } from './Card';

let mockScheme: 'light' | 'dark' = 'light';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  const flatten = (style: unknown): Record<string, unknown> => {
    const result: Record<string, unknown> = {};
    const append = (value: unknown): void => {
      if (!value) return;
      if (typeof value === 'function') {
        append(value({ pressed: false }));
      } else if (Array.isArray(value)) {
        value.forEach(append);
      } else if (typeof value === 'object') {
        Object.assign(result, value);
      }
    };
    append(style);
    return result;
  };
  return {
    Pressable: primitive('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    View: primitive('View'),
  };
});

jest.mock('../../theme', () => {
  const { buildTheme: createTheme } = jest.requireActual('../../theme/theme');
  const { builtInAccents: accents } = jest.requireActual('../../theme/accents');
  return {
    useAppTheme: () => ({
      theme: createTheme(mockScheme, mockScheme, accents.iceBlue),
    }),
  };
});

describe.each(['light', 'dark'] as const)('%s Card', (scheme) => {
  beforeEach(() => {
    mockScheme = scheme;
  });

  it('uses the canonical card radius without outlining the default flat surface', () => {
    const result = render(
      <Card>
        <Text>Content</Text>
      </Card>,
    );
    const theme = buildTheme(scheme, scheme, builtInAccents.iceBlue);
    const style = StyleSheet.flatten(result.UNSAFE_getByType(View).props.style) as Record<string, unknown>;

    expect(style).toMatchObject({
      borderRadius: Radius.card,
      backgroundColor: theme.colors.surface,
    });
    expect(style).not.toHaveProperty('borderWidth');
    expect(style).not.toHaveProperty('borderColor');
  });
});
