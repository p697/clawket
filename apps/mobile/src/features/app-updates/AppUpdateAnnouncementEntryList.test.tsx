import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import type { AppTheme } from '../../theme';
import { AppUpdateAnnouncementEntryList, isNavigableAppUpdateEntry } from './AppUpdateAnnouncementEntryList';
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
  const icon = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return new Proxy({}, { get: (_target, name: string) => icon(name) });
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => `[${key}]`,
    i18n: { language: 'en' },
  }),
}));

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
    icon: 'layout',
    tag: 'New',
    title: 'All your Agents on one screen',
    subtitle: 'See who is busy and who has news at a glance.',
    action: { type: 'none' },
  },
  {
    id: 'repo',
    icon: 'star',
    title: 'Now Open Source!',
    action: { type: 'open_url', url: 'https://example.com' },
  },
  {
    id: 'membership',
    icon: 'sparkles',
    title: 'Clawket Pro',
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

  it('translates catalog copy, maps icons, and only makes link and paywall entries pressable', () => {
    const onEntryPress = jest.fn();
    const view = render(
      <AppUpdateAnnouncementEntryList entries={entries} colors={colors} onEntryPress={onEntryPress} />,
    );

    expect(view.getByText('[All your Agents on one screen]')).toBeTruthy();
    expect(view.getByText('[See who is busy and who has news at a glance.]')).toBeTruthy();
    expect(view.getByText('[New]')).toBeTruthy();
    expect(view.getByTestId('app-update-entry-overview-icon').type).toBe('LayoutGrid');
    expect(view.getByTestId('app-update-entry-repo-icon').type).toBe('Star');
    expect(view.getByTestId('app-update-entry-membership-icon').type).toBe('Sparkles');

    expect(view.getByTestId('app-update-entry-overview').props.accessibilityRole).toBeUndefined();
    expect(view.getByTestId('app-update-entry-repo').props).toMatchObject({
      accessibilityRole: 'button',
      accessibilityLabel: '[Now Open Source!]',
    });
    expect(view.getByTestId('app-update-entry-membership').props.accessibilityRole).toBe('button');
    expect(view.getByTestId('app-update-entry-overview-row').props.style).not.toHaveProperty('borderBottomWidth');

    fireEvent.press(view.getByTestId('app-update-entry-membership'));
    expect(onEntryPress).toHaveBeenCalledWith(entries[2]);
  });

  it('renders every entry inert without a press handler', () => {
    const view = render(<AppUpdateAnnouncementEntryList entries={entries} colors={colors} />);
    expect(view.getByTestId('app-update-entry-membership').props.accessibilityRole).toBeUndefined();
    expect(isNavigableAppUpdateEntry(entries[0]!)).toBe(false);
    expect(isNavigableAppUpdateEntry(entries[1]!)).toBe(true);
    expect(isNavigableAppUpdateEntry(entries[2]!)).toBe(true);
  });
});
