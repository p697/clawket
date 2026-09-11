import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import type { AppTheme } from '../../theme';
import { AppUpdateAnnouncementEntryList } from './AppUpdateAnnouncementEntryList';
import type { AppUpdateAnnouncementEntry } from './releases';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, style, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(
      name,
      { ...props, style: typeof style === 'function' ? style({ pressed: false }) : style },
      children,
    )
  );
  return {
    Pressable: host('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  return {
    ChevronRight: (props: Record<string, unknown>) => ReactRuntime.createElement('ChevronRight', props),
    Rocket: (props: Record<string, unknown>) => ReactRuntime.createElement('Rocket', props),
    Sparkles: (props: Record<string, unknown>) => ReactRuntime.createElement('Sparkles', props),
  };
});

const colors = {
  canvas: 'canvas',
  canvasGrouped: 'canvas-grouped',
  surface: 'surface',
  surfaceFloating: 'surface-floating',
  ink: 'ink',
  inkSecondary: 'ink-secondary',
  inkTertiary: 'ink-tertiary',
  line: 'line',
  accent: 'accent',
  accentSoft: 'accent-soft',
  onAccent: 'on-accent',
  scrim: 'scrim',
  good: 'good',
  goodSoft: 'good-soft',
  warn: 'warn',
  warnSoft: 'warn-soft',
  bad: 'bad',
  badSoft: 'bad-soft',
} satisfies AppTheme['colors'];

const entries: AppUpdateAnnouncementEntry[] = [
  {
    id: 'overview',
    icon: 'rocket',
    title: 'Clawket 3.0',
    action: { type: 'none' },
  },
  {
    id: 'membership',
    icon: 'sparkles',
    title: 'Clawket 3.0 + Pro',
    action: {
      type: 'open_paywall',
      feature: 'settingsMembershipPreview',
    },
  },
];

describe('AppUpdateAnnouncementEntryList', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    const original = console.error;
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown, ...rest: unknown[]) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
      original(message, ...rest);
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('makes the membership entry navigable and leaves informational entries inert', () => {
    const onEntryPress = jest.fn();
    const view = render(
      <AppUpdateAnnouncementEntryList
        entries={entries}
        colors={colors}
        onEntryPress={onEntryPress}
        t={(key) => key.replace(/^chat:/, '')}
      />,
    );

    expect(view.getByTestId('app-update-entry-overview').props.accessibilityRole).toBeUndefined();
    expect(view.getByTestId('app-update-entry-membership').props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: 'Clawket 3.0 + Pro',
    });
    expect(view.getByTestId('app-update-entry-overview-icon')).toBeTruthy();
    expect(view.getByTestId('app-update-entry-membership-icon')).toBeTruthy();
    expect(view.getByTestId('app-update-entry-overview-row').props.style).not.toHaveProperty('borderBottomWidth');
    expect(view.queryByText('icon')).toBeNull();
    fireEvent.press(view.getByTestId('app-update-entry-membership'));
    expect(onEntryPress).toHaveBeenCalledWith(entries[1]);
  });
});
