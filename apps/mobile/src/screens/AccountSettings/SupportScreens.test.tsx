import fs from 'node:fs';
import path from 'node:path';
import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { FontSize } from '../../theme/tokens';
import { DesignSystemScreen } from './DesignSystemScreen';
import {
  getHelpCenterCommunityEntries,
  HelpCenterScreen,
} from './HelpCenterScreen';
import {
  formatReleaseDate,
  ReleaseNotesHistoryScreen,
} from './ReleaseNotesHistoryScreen';

const lightColors = {
  canvas: '#FFFFFF',
  canvasGrouped: '#F5F5F7',
  surface: '#F2F2F4',
  surfaceFloating: '#FFFFFF',
  ink: '#111113',
  inkSecondary: '#6B6B72',
  inkTertiary: '#A3A3AB',
  line: '#E6E6EA',
  accent: '#1F5EFF',
  accentSoft: '#E8EEFF',
  onAccent: '#FFFFFF',
  scrim: 'rgba(0,0,0,0.4)',
  good: '#178A6A',
  goodSoft: '#E4F3EE',
  warn: '#D9791C',
  warnSoft: '#FAEDE1',
  bad: '#D64545',
  badSoft: '#F9E7E7',
};

const mockSetMode = jest.fn();
const mockSetAccentId = jest.fn();
const mockSaveBundledImage = jest.fn();
const mockSetStringAsync = jest.fn();

jest.mock('../../../assets/wechat-group-qr.jpg', () => 1);

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(
    ({ children, style, ...props }: Record<string, unknown>, ref: unknown) => ReactRuntime.createElement(
      name,
      {
        ...props,
        ref,
        style: typeof style === 'function' ? style({ pressed: false }) : style,
      },
      children,
    ),
  );
  const Modal = ({ visible, children, ...props }: Record<string, unknown>) => (
    visible ? ReactRuntime.createElement('Modal', props, children) : null
  );
  return {
    ActivityIndicator: host('ActivityIndicator'),
    Image: host('Image'),
    Linking: { openURL: jest.fn(async () => undefined) },
    Modal,
    Platform: {
      OS: 'android',
      select: (options: Record<string, unknown>) => options.android ?? options.default,
    },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      absoluteFillObject: {
        position: 'absolute',
        top: 0,
        right: 0,
        bottom: 0,
        left: 0,
      },
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
    Switch: host('Switch'),
    Text: host('Text'),
    TextInput: host('TextInput'),
    useWindowDimensions: () => ({
      width: 375,
      height: 812,
      scale: 3,
      fontScale: 1,
    }),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props);
  return new Proxy({}, { get: () => icon });
});

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 24, bottom: 16, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    i18n: { language: 'en' },
    t: (key: string, options?: Record<string, unknown>) => {
      const naturalKey = key.includes(':') ? key.slice(key.indexOf(':') + 1) : key;
      return naturalKey.replace(
        /\{\{(\w+)\}\}/g,
        (_match, name: string) => String(options?.[name] ?? ''),
      );
    },
  }),
}));

jest.mock('../../theme', () => {
  const ReactRuntime = require('react');
  return {
    ThemeContext: ReactRuntime.createContext(null),
    builtInAccents: {
      iceBlue: { light: { accent500: '#1F5EFF' }, dark: { accent500: '#6B95FF' } },
      jadeGreen: { light: { accent500: '#147A5B' }, dark: { accent500: '#52C49A' } },
      oceanTeal: { light: { accent500: '#0F7180' }, dark: { accent500: '#55C2D0' } },
      sunsetOrange: { light: { accent500: '#A85312' }, dark: { accent500: '#F1A45B' } },
      rosePink: { light: { accent500: '#B12D62' }, dark: { accent500: '#F0709F' } },
      royalPurple: { light: { accent500: '#6C43C2' }, dark: { accent500: '#A98BFF' } },
    },
    useAppTheme: () => ({
      theme: { scheme: 'light', colors: lightColors },
      mode: 'system',
      accentId: 'iceBlue',
      setMode: mockSetMode,
      setAccentId: mockSetAccentId,
    }),
  };
});

jest.mock('../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    createFloatingSurfaceStyle: () => ({ backgroundColor: lightColors.surfaceFloating }),
    FloatingButton: ({ testID, onPress, accessibilityLabel, disabled }: {
      testID?: string;
      onPress: () => void;
      accessibilityLabel: string;
      disabled?: boolean;
    }) => ReactRuntime.createElement(Pressable, {
      testID,
      onPress,
      accessibilityLabel,
      disabled,
    }),
  };
});

jest.mock('../../components/ui/ThemedSwitch', () => {
  const ReactRuntime = require('react');
  const { Switch } = require('react-native');
  return {
    ThemedSwitch: (props: Record<string, unknown>) => ReactRuntime.createElement(Switch, props),
  };
});

jest.mock('../../services/haptics', () => ({
  triggerLightImpact: jest.fn(),
}));

jest.mock('../../services/photo-library', () => ({
  saveBundledImageToPhotoLibrary: (...args: unknown[]) => mockSaveBundledImage(...args),
}));

jest.mock('../../config/public', () => ({
  buildSupportEmailUrl: (email: string | null) => email ? `mailto:${email}` : null,
  publicAppLinks: {
    discordInviteUrl: 'https://discord.example/clawket',
    docsUrl: 'https://docs.example/openclaw',
    openClawReleasesUrl: 'https://github.example/openclaw/releases',
    supportEmail: 'support@example.com',
  },
}));

jest.mock('../../utils/mainlandChina', () => ({
  shouldShowWecomSupportEntry: () => true,
}));

jest.mock('expo-clipboard', () => ({
  setStringAsync: (...args: unknown[]) => mockSetStringAsync(...args),
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  return Object.assign({}, ...style.map(flattenStyle));
}

type RenderNode = Readonly<{ props: Readonly<Record<string, unknown>> }>;

function renderedFontSizes(view: ReturnType<typeof render>): ReadonlyArray<number> {
  const sizes = new Set<number>();
  view.UNSAFE_root
    .findAll((node: RenderNode) => Boolean(node.props.style))
    .forEach((node: RenderNode) => {
      const value = flattenStyle(node.props.style).fontSize;
      if (typeof value === 'number') sizes.add(value);
    });
  return [...sizes].sort((a, b) => a - b);
}

function screenSource(file: string): string {
  return fs.readFileSync(path.join(__dirname, file), 'utf8');
}

describe('AccountSettings support screens', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSaveBundledImage.mockResolvedValue('saved');
    mockSetStringAsync.mockResolvedValue(undefined);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('keeps all three default views on grouped canvas with the three-size budget', () => {
    const screens = [
      render(<HelpCenterScreen onBack={jest.fn()} showWecomEntry />),
      render(<ReleaseNotesHistoryScreen onBack={jest.fn()} />),
      render(<DesignSystemScreen onBack={jest.fn()} />),
    ];
    const rootIds = [
      'help-center-screen',
      'release-notes-screen',
      'design-system-screen',
    ];

    screens.forEach((view, index) => {
      expect(flattenStyle(view.getByTestId(rootIds[index]).props.style)).toEqual(
        expect.objectContaining({ backgroundColor: lightColors.canvasGrouped }),
      );
      expect(renderedFontSizes(view)).toEqual([
        FontSize.secondary,
        FontSize.body,
        FontSize.title,
      ]);
      view.unmount();
    });

    [
      'HelpCenterScreen.tsx',
      'ReleaseNotesHistoryScreen.tsx',
      'DesignSystemScreen.tsx',
    ].forEach((file) => {
      const source = screenSource(file);
      const fontTokens = new Set(
        [...source.matchAll(/FontSize\.(\w+)/g)].map((match) => match[1]),
      );
      expect(fontTokens.size).toBeLessThanOrEqual(3);
      expect(source).not.toMatch(/\bborderWidth\s*:/);
      expect(source).not.toMatch(/\bsubtitle=/);
    });
  });

  it('opens connection details and copies the current pairing command', async () => {
    const view = render(<HelpCenterScreen onBack={jest.fn()} showWecomEntry />);

    fireEvent.press(view.getByTestId('help-topic-row-pair'));
    expect(view.getByTestId('help-topic-sheet-pair')).toBeTruthy();
    expect(view.getByText('npx @p697/clawket pair')).toBeTruthy();
    fireEvent.press(view.getByTestId('help-command-pair-0'));

    await waitFor(() => {
      expect(mockSetStringAsync).toHaveBeenCalledWith('npx @p697/clawket pair');
    });

    fireEvent.press(view.getByTestId('help-topic-sheet-pair-close'));
    fireEvent.press(view.getByTestId('help-center-tabs-troubleshooting'));
    fireEvent.press(view.getByTestId('help-topic-row-running'));
    expect(view.getByText('openclaw status')).toBeTruthy();
    expect(view.getByText('openclaw doctor')).toBeTruthy();
  });

  it('opens official support links and saves the WeCom QR without a system alert', async () => {
    const onBack = jest.fn();
    const onOpenUrl = jest.fn(async () => undefined);
    const view = render(
      <HelpCenterScreen
        onBack={onBack}
        onOpenUrl={onOpenUrl}
        showWecomEntry
      />,
    );

    fireEvent.press(view.getByTestId('help-center-tabs-official'));
    fireEvent.press(view.getByTestId('help-official-openclaw-docs'));
    fireEvent.press(view.getByTestId('help-official-hermes-docs'));
    fireEvent.press(view.getByTestId('help-official-discord'));

    await waitFor(() => {
      expect(onOpenUrl).toHaveBeenNthCalledWith(1, 'https://docs.example/openclaw');
      expect(onOpenUrl).toHaveBeenNthCalledWith(
        2,
        'https://hermes-agent.nousresearch.com/docs/getting-started/quickstart',
      );
      expect(onOpenUrl).toHaveBeenNthCalledWith(3, 'https://discord.example/clawket');
    });

    fireEvent.press(view.getByTestId('help-official-wecom'));
    expect(view.getByTestId('help-wecom-sheet')).toBeTruthy();
    fireEvent.press(view.getByTestId('help-wecom-save'));

    await waitFor(() => {
      expect(mockSaveBundledImage).toHaveBeenCalledWith(
        expect.anything(),
        'wechat-group-qr',
      );
      expect(view.getByText('QR code saved to your photo library.')).toBeTruthy();
    });

    fireEvent.press(view.getByTestId('help-center-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('keeps permission failure feedback inside the WeCom sheet', async () => {
    mockSaveBundledImage.mockResolvedValueOnce('permission_denied');
    const view = render(<HelpCenterScreen onBack={jest.fn()} showWecomEntry />);

    fireEvent.press(view.getByTestId('help-center-tabs-official'));
    fireEvent.press(view.getByTestId('help-official-wecom'));
    fireEvent.press(view.getByTestId('help-wecom-save'));

    await waitFor(() => {
      expect(view.getByText('Please allow photo library access and try again.')).toBeTruthy();
    });
  });

  it('renders the 3.0 history and opens the membership paywall from its final entry', () => {
    const onBack = jest.fn();
    const onOpenPaywall = jest.fn();
    const view = render(
      <ReleaseNotesHistoryScreen
        onBack={onBack}
        onOpenPaywall={onOpenPaywall}
      />,
    );

    expect(view.getByText('v3.0.0')).toBeTruthy();
    expect(view.getByText('Clawket 3.0')).toBeTruthy();
    expect(view.getByText('Every agent and session in one roster.')).toBeTruthy();
    expect(view.getByText('Clawket 3.0 + Pro')).toBeTruthy();
    expect(view.getByText('Unlimited connections, agents, management, logs, files, and search.')).toBeTruthy();
    expect(formatReleaseDate('not-a-date', 'en')).toBe('not-a-date');
    expect(view.getByTestId('release-notes-entry-clawket-3-0-pro').props.accessibilityRole).toBe('button');

    fireEvent.press(view.getByTestId('release-notes-entry-clawket-3-0-pro'));
    fireEvent.press(view.getByTestId('release-notes-back'));
    expect(onOpenPaywall).toHaveBeenCalledWith('settingsMembershipPreview');
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('keeps theme, token, control, and sheet samples interactive', () => {
    const view = render(<DesignSystemScreen onBack={jest.fn()} />);

    fireEvent.press(view.getByTestId('design-system-theme-dark'));
    fireEvent.press(view.getByTestId('design-system-accent-jadeGreen'));
    expect(mockSetMode).toHaveBeenCalledWith('dark');
    expect(mockSetAccentId).toHaveBeenCalledWith('jadeGreen');

    fireEvent.press(view.getByTestId('design-system-tabs-tokens'));
    expect(view.getByText('surfaceFloating')).toBeTruthy();
    expect(view.getByText('title · 20/26')).toBeTruthy();

    fireEvent.press(view.getByTestId('design-system-tabs-components'));
    fireEvent.changeText(view.getByTestId('design-system-search-input'), 'sheet');
    fireEvent.changeText(view.getByTestId('design-system-field'), 'Clawket 3.0');
    fireEvent(view.getByTestId('design-system-switch'), 'valueChange', false);
    expect(view.getByTestId('design-system-search-input').props.value).toBe('sheet');
    expect(view.getByTestId('design-system-field').props.value).toBe('Clawket 3.0');
    expect(view.getByTestId('design-system-switch').props.value).toBe(false);

    fireEvent.press(view.getByTestId('design-system-interactive-row'));
    expect(view.getByTestId('design-system-sheet')).toBeTruthy();
    fireEvent.press(view.getByText('Done'));
    expect(view.queryByTestId('design-system-sheet')).toBeNull();
  });
});

describe('getHelpCenterCommunityEntries', () => {
  it('adds WeCom only for mainland China users', () => {
    expect(getHelpCenterCommunityEntries(false)).toEqual(['discord']);
    expect(getHelpCenterCommunityEntries(true)).toEqual(['discord', 'wecom']);
  });
});
