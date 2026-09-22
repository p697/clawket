import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { ANNOUNCEMENT_COMPANION_SIZE, AppUpdateAnnouncementSheet } from './AppUpdateAnnouncementSheet';
import { getAppUpdateRelease, type AppUpdateAnnouncement } from './releases';

let mockReducedMotion = false;

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
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
    Text: host('Text'),
    View: host('View'),
  };
});

jest.mock('react-native-reanimated', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View: ({ children, entering, ...props }: Record<string, unknown>) => (
      ReactRuntime.createElement(View, { ...props, entering: entering ? 'animated' : undefined }, children)
    ) },
    FadeIn: { duration: () => ({}) },
    FadeInDown: { duration: () => ({}) },
    useReducedMotion: () => mockReducedMotion,
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    BottomSheetScrollView: ({ children, contentContainerStyle }: { children: React.ReactNode; contentContainerStyle?: unknown }) => (
      ReactRuntime.createElement(View, { testID: 'announcement-scroll', style: contentContainerStyle }, children)
    ),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (name: string) => (props: Record<string, unknown>) => ReactRuntime.createElement(name, props);
  return new Proxy({}, { get: (_target, name: string) => icon(name) });
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { ns?: string }) => (options?.ns ? `${options.ns}:${key}` : key),
    i18n: { language: 'en' },
  }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        canvas: 'canvas', canvasGrouped: 'canvas-grouped', surface: 'surface', surfaceFloating: 'surface-floating',
        ink: 'ink', inkSecondary: 'ink-secondary', inkTertiary: 'ink-tertiary', line: 'line',
        accent: 'accent', accentSoft: 'accent-soft', onAccent: 'on-accent', scrim: 'scrim',
        good: 'good', goodSoft: 'good-soft', warn: 'warn', warnSoft: 'warn-soft', bad: 'bad', badSoft: 'bad-soft',
      },
    },
  }),
}));

jest.mock('../../components/ui/Companion', () => {
  const ReactRuntime = require('react');
  return {
    Companion: (props: Record<string, unknown>) => ReactRuntime.createElement('Companion', props),
  };
});

jest.mock('../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ label, onPress, testID }: { label: string; onPress: () => void; testID?: string }) => (
      ReactRuntime.createElement(Pressable, { testID, onPress }, ReactRuntime.createElement(Text, null, label))
    ),
  };
});

jest.mock('../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { Pressable, View } = require('react-native');
  return {
    Sheet: ({ children, footer, testID, visible, onClose, snapPoints }: {
      children: React.ReactNode;
      footer?: React.ReactNode;
      testID?: string;
      visible: boolean;
      onClose: () => void;
      snapPoints?: string[];
    }) => (visible ? ReactRuntime.createElement(
      View,
      { testID, snapPoints },
      ReactRuntime.createElement(Pressable, { testID: `${testID}-close`, onPress: onClose }),
      children,
      ReactRuntime.createElement(View, { testID: `${testID}-footer` }, footer),
    ) : null),
  };
});

const release = getAppUpdateRelease('3.0.0')!;

function announcement(overrides: Partial<AppUpdateAnnouncement> = {}): AppUpdateAnnouncement {
  return { currentVersion: '3.0.0', releases: [release], debugHint: null, ...overrides };
}

function renderSheet(props: Partial<React.ComponentProps<typeof AppUpdateAnnouncementSheet>> = {}) {
  const callbacks = {
    onClose: jest.fn(),
    onAfterClose: jest.fn(),
    onContinue: jest.fn(),
    onEntryPress: jest.fn(),
  };
  const view = render(
    <AppUpdateAnnouncementSheet visible announcement={announcement()} {...callbacks} {...props} />,
  );
  return { view, callbacks };
}

describe('AppUpdateAnnouncementSheet', () => {
  beforeEach(() => {
    mockReducedMotion = false;
  });

  it('leads with the large curious Companion, the release hero copy and a pinned Continue', () => {
    const { view, callbacks } = renderSheet();
    const companion = view.getByTestId('app-update-announcement-companion', { includeHiddenElements: true });
    expect(companion.props).toMatchObject({ size: ANNOUNCEMENT_COMPANION_SIZE, pose: 'curious' });
    expect(view.getByTestId('app-update-announcement').props.snapPoints).toEqual(['92%']);
    expect(view.getByTestId('app-update-announcement-title').props.children).toBe('Meet Clawket 3.0');
    expect(view.getByText('A brand-new experience, interface, and product.')).toBeTruthy();
    expect(view.getByTestId('app-update-announcement-version').props.children).toEqual(['v', '3.0.0']);
    expect(view.queryByTestId('app-update-announcement-release-3.0.0')).toBeNull();
    expect(view.queryByTestId('app-update-announcement-debug-hint')).toBeNull();

    fireEvent.press(view.getByTestId('app-update-announcement-continue'));
    expect(callbacks.onContinue).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByTestId('app-update-announcement-close'));
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);

    expect(view.queryByText('Clawket Pro')).toBeNull();
    expect(view.getByTestId('app-update-entry-roster').props.accessibilityRole).toBeUndefined();
  });

  it('forwards presses only for link entries, such as the 1.6.0 open-source note', () => {
    const { view, callbacks } = renderSheet({
      announcement: announcement({ currentVersion: '1.6.0', releases: [getAppUpdateRelease('1.6.0')!] }),
    });
    fireEvent.press(view.getByTestId('app-update-entry-open-source-github'));
    expect(callbacks.onEntryPress).toHaveBeenCalledWith(expect.objectContaining({ id: 'open-source-github' }));
  });

  it('labels each release when several were skipped and falls back to the generic title', () => {
    const older = getAppUpdateRelease('2.1.0')!;
    const { view } = renderSheet({
      announcement: announcement({ currentVersion: '2.1.0', releases: [older, getAppUpdateRelease('1.10.0')!] }),
    });
    expect(view.getByTestId('app-update-announcement-title').props.children).toBe("What's New");
    expect(view.getByTestId('app-update-announcement-release-2.1.0')).toBeTruthy();
    expect(view.getByTestId('app-update-announcement-release-1.10.0')).toBeTruthy();
    expect(view.getByText('Discover')).toBeTruthy();
  });

  it('shows the translated debug hint for developer previews and renders nothing without content', () => {
    const { view } = renderSheet({
      announcement: announcement({ debugHint: 'Debug mode is on, so this preview ignores the one-time cache.' }),
    });
    expect(view.getByTestId('app-update-announcement-debug-hint').props.children)
      .toBe('Debug mode is on, so this preview ignores the one-time cache.');

    const empty = render(
      <AppUpdateAnnouncementSheet visible announcement={null} onClose={jest.fn()} onContinue={jest.fn()} onEntryPress={jest.fn()} />,
    );
    expect(empty.toJSON()).toBeNull();
  });

  it('skips entrance motion under reduced motion', () => {
    mockReducedMotion = true;
    const { view } = renderSheet();
    const scroll = view.getByTestId('announcement-scroll');
    const animated = scroll.findAll((node: { props: Record<string, unknown> }) => node.props.entering === 'animated');
    expect(animated).toHaveLength(0);
  });
});

it('adds an actionable Bridge guide only to 3.0 with verified old connections', () => {
  const onEntryPress = jest.fn();
  const { view } = renderSheet({ bridgeUpgradeAvailable: true, onEntryPress });
  fireEvent.press(view.getByText('Update your Bridge'));
  expect(onEntryPress).toHaveBeenCalledWith(expect.objectContaining({ action: { type: 'open_bridge_upgrade' } }));
});
it('does not advertise a Bridge update to everyone', () => {
  expect(renderSheet().view.queryByText('Update your Bridge')).toBeNull();
});
