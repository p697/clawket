import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import { FontSize } from '../../theme/tokens';
import type { ChatAppearanceSettings } from '../../types/chat-appearance';
import { ChatAppearanceScreen } from './ChatAppearanceScreen';

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

const mockSetAccentId = jest.fn();
const mockUseAppContext = jest.fn();
const mockUseConnections = jest.fn();
const mockChatAppearanceOpened = jest.fn();
const mockChatAppearanceSaved = jest.fn();
const mockPickChatBackgroundImage = jest.fn();
const mockPersistChatBackgroundImage = jest.fn();
const mockDeletePersistedChatBackgroundImage = jest.fn();

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
    Modal,
    Platform: {
      OS: 'android',
      select: (options: Record<string, unknown>) => options.android ?? options.default,
    },
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      absoluteFill: {
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
    Text: host('Text'),
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
    useAppTheme: () => ({ theme: { scheme: 'light', colors: lightColors }, accentId: 'iceBlue', setAccentId: mockSetAccentId }),
  };
});

jest.mock('../../contexts/AppContext', () => ({
  useAppContext: () => mockUseAppContext(),
}));
jest.mock('../../connection', () => ({
  useConnections: () => mockUseConnections(),
}));

jest.mock('../../components/chat/ChatAppearancePreviewCard', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ChatAppearancePreviewCard: (props: Record<string, unknown>) => ReactRuntime.createElement(
      View,
      { ...props, testID: 'chat-appearance-preview-card' },
    ),
  };
});

jest.mock('../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    FloatingButton: ({ testID, onPress, accessibilityLabel }: {
      testID?: string;
      onPress: () => void;
      accessibilityLabel: string;
    }) => ReactRuntime.createElement(Pressable, { testID, onPress, accessibilityLabel }),
  };
});

jest.mock('../../components/ui/ThemedSwitch', () => {
  const ReactRuntime = require('react');
  return {
    ThemedSwitch: (props: Record<string, unknown>) => ReactRuntime.createElement('Switch', props),
  };
});

jest.mock('../../features/chat-appearance/image-store', () => ({
  pickChatBackgroundImage: (...args: unknown[]) => mockPickChatBackgroundImage(...args),
  persistChatBackgroundImage: (...args: unknown[]) => mockPersistChatBackgroundImage(...args),
  deletePersistedChatBackgroundImage: (...args: unknown[]) => mockDeletePersistedChatBackgroundImage(...args),
}));

jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: {
    chatAppearanceOpened: (...args: unknown[]) => mockChatAppearanceOpened(...args),
    chatAppearanceSaved: (...args: unknown[]) => mockChatAppearanceSaved(...args),
  },
}));

function flattenStyle(style: unknown): Record<string, unknown> {
  if (!style) return {};
  if (!Array.isArray(style)) return style as Record<string, unknown>;
  return Object.assign({}, ...style.map(flattenStyle));
}

function appearance(
  patch: Partial<ChatAppearanceSettings> = {},
): ChatAppearanceSettings {
  return {
    version: 1,
    background: {
      enabled: false,
      blur: 8,
      dim: 0,
      fillMode: 'cover',
      ...patch.background,
    },
    bubbles: {
      style: 'solid',
      opacity: 1,
      ...patch.bubbles,
    },
  };
}

function createContext(
  patch: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    agents: [{ id: 'main', connectionId: 'connection-1', name: 'Assistant', identity: { name: '助手', emoji: '🐱' } }],
    currentAgentId: 'main',
    chatAppearance: appearance(),
    showAgentAvatar: true,
    showModelUsage: true,
    chatFontSize: 16,
    onChatAppearanceChange: jest.fn(),
    onShowAgentAvatarToggle: jest.fn(),
    onShowModelUsageToggle: jest.fn(),
    onChatFontSizeChange: jest.fn(),
    ...patch,
  };
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

describe('ChatAppearanceScreen', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAppContext.mockReturnValue(createContext());
    mockUseConnections.mockReturnValue({ activeConnectionId: null, roster: [] });
    mockPickChatBackgroundImage.mockResolvedValue('file:///picked.jpg');
    mockPersistChatBackgroundImage.mockResolvedValue('file:///stored/background.jpg');
    mockDeletePersistedChatBackgroundImage.mockResolvedValue(undefined);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it('uses the grouped canvas, three-type budget, and borderless setting rows without descriptions', () => {
    const view = render(<ChatAppearanceScreen onBack={jest.fn()} />);

    expect(flattenStyle(view.getByTestId('chat-appearance-screen').props.style)).toEqual(
      expect.objectContaining({ backgroundColor: lightColors.canvasGrouped }),
    );
    expect(renderedFontSizes(view)).toEqual([
      FontSize.secondary,
      FontSize.body,
      FontSize.title,
    ]);
    [
      'chat-appearance-background',
      'chat-appearance-blur',
      'chat-appearance-dim',
      'chat-appearance-opacity',
      'chat-appearance-font-size',
      'chat-appearance-reset',
    ].forEach((testID) => {
      expect(flattenStyle(view.getByTestId(testID).props.style).borderWidth).toBeUndefined();
    });
    expect(view.queryByText('Soften the wallpaper behind the chat content.')).toBeNull();
    expect(view.queryByText('Display avatar beside agent messages')).toBeNull();
    expect(mockChatAppearanceOpened).toHaveBeenCalledWith({ source: 'account_settings' });
  });

  it('edits every appearance family and saves a persisted background', async () => {
    const onBack = jest.fn();
    const context = createContext();
    mockUseAppContext.mockReturnValue(context);
    const view = render(<ChatAppearanceScreen onBack={onBack} />);

    fireEvent(view.getByTestId('chat-appearance-agent-avatar'), 'valueChange', false);
    fireEvent.press(view.getByTestId('chat-appearance-bubble-style-soft'));
    fireEvent.press(view.getByTestId('chat-appearance-font-size'));
    fireEvent.press(view.getByTestId('chat-appearance-font-size-18'));
    fireEvent.press(view.getByTestId('chat-appearance-opacity'));
    fireEvent.press(view.getByTestId('chat-appearance-opacity-0.84'));
    fireEvent.press(view.getByTestId('chat-appearance-background'));

    await waitFor(() => {
      expect(view.getByTestId('chat-appearance-remove-background')).toBeTruthy();
    });
    fireEvent.press(view.getByTestId('chat-appearance-blur'));
    fireEvent.press(view.getByTestId('chat-appearance-blur-12'));
    fireEvent.press(view.getByTestId('chat-appearance-dim'));
    fireEvent.press(view.getByTestId('chat-appearance-dim-0.3'));
    fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(mockPersistChatBackgroundImage).toHaveBeenCalledWith('file:///picked.jpg');
    expect(context.onChatAppearanceChange).toHaveBeenCalledWith(expect.objectContaining({
      background: expect.objectContaining({
        enabled: true,
        imagePath: 'file:///stored/background.jpg',
        blur: 12,
        dim: 0.3,
      }),
      bubbles: { style: 'soft', opacity: 0.84 },
    }));
    expect(context.onShowAgentAvatarToggle).toHaveBeenCalledWith(false);
    expect(context.onChatFontSizeChange).toHaveBeenCalledWith(18);
    expect(mockChatAppearanceSaved).toHaveBeenCalledWith(expect.objectContaining({
      has_background_image: true,
      bubble_style: 'soft',
      blur: 12,
      dim: 0.3,
      chat_font_size: 18,
    }));
  });

  it('keeps dirty edits until confirmed and removes an existing background on save', async () => {
    const onBack = jest.fn();
    const context = createContext({
      chatAppearance: appearance({
        background: {
          enabled: true,
          imagePath: 'file:///stored/old.jpg',
          blur: 8,
          dim: 0,
          fillMode: 'cover',
        },
      }),
    });
    mockUseAppContext.mockReturnValue(context);
    const view = render(<ChatAppearanceScreen onBack={onBack} />);

    fireEvent.press(view.getByTestId('chat-appearance-remove-background'));
    fireEvent.press(view.getByTestId('chat-appearance-back'));
    expect(view.getByTestId('chat-appearance-discard-sheet')).toBeTruthy();
    expect(onBack).not.toHaveBeenCalled();

    fireEvent.press(view.getByText('Keep Editing'));
    expect(view.queryByTestId('chat-appearance-discard-sheet')).toBeNull();
    fireEvent.press(view.getByText('Save'));

    await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
    expect(mockDeletePersistedChatBackgroundImage).toHaveBeenCalledWith('file:///stored/old.jpg');
    expect(context.onChatAppearanceChange).toHaveBeenCalledWith(expect.objectContaining({
      background: expect.objectContaining({ enabled: false, imagePath: undefined }),
    }));
  });

  it('preserves the old wallpaper when preference persistence fails and removes the staged copy', async () => {
    const onBack = jest.fn();
    mockUseAppContext.mockReturnValue(createContext({
      chatAppearance: appearance({ background: {
        enabled: true, imagePath: 'file:///stored/old.jpg', blur: 8, dim: 0, fillMode: 'cover',
      } }),
      onChatAppearanceChange: jest.fn().mockRejectedValue(new Error('Storage unavailable')),
    }));
    const view = render(<ChatAppearanceScreen onBack={onBack} />);
    fireEvent.press(view.getByTestId('chat-appearance-background'));
    await waitFor(() => expect(mockPickChatBackgroundImage).toHaveBeenCalled());
    fireEvent.press(view.getByText('Save'));
    await waitFor(() => expect(view.getByText('Unable to save chat appearance')).toBeTruthy());
    expect(mockDeletePersistedChatBackgroundImage).toHaveBeenCalledWith('file:///stored/background.jpg');
    expect(mockDeletePersistedChatBackgroundImage).not.toHaveBeenCalledWith('file:///stored/old.jpg');
    expect(onBack).not.toHaveBeenCalled();
    expect(mockChatAppearanceSaved).not.toHaveBeenCalled();
  });

  it('shows an app-owned error sheet when the photo picker fails', async () => {
    mockPickChatBackgroundImage.mockRejectedValueOnce(new Error('denied'));
    const view = render(<ChatAppearanceScreen onBack={jest.fn()} />);

    fireEvent.press(view.getByTestId('chat-appearance-background'));
    await waitFor(() => {
      expect(view.getByTestId('chat-appearance-error-sheet')).toBeTruthy();
    });
    expect(view.getByText('Unable to open photo library')).toBeTruthy();
    fireEvent.press(view.getByText('Done'));
    expect(view.queryByTestId('chat-appearance-error-sheet')).toBeNull();
  });
});


it('previews the Agent the person is chatting with, preferring the live roster identity', () => {
  mockUseAppContext.mockReturnValue(createContext());
  mockUseConnections.mockReturnValue({ activeConnectionId: null, roster: [] });
  const fallback = render(<ChatAppearanceScreen onBack={jest.fn()} />);
  expect(fallback.getByTestId('chat-appearance-preview-card').props.agent).toEqual({
    agentId: 'main', name: '助手', emoji: '🐱', avatarUrl: undefined,
  });
  fallback.unmount();

  mockUseConnections.mockReturnValue({
    activeConnectionId: 'connection-1',
    roster: [{
      connection: { id: 'connection-1' },
      agents: [{ agent: { agentId: 'main', name: '小助手', emoji: undefined, avatarUrl: 'file:///avatars/main.png' } }],
    }],
  });
  const live = render(<ChatAppearanceScreen onBack={jest.fn()} />);
  expect(live.getByTestId('chat-appearance-preview-card').props.agent).toEqual({
    agentId: 'main', name: '小助手', emoji: undefined, avatarUrl: 'file:///avatars/main.png',
  });

  mockUseAppContext.mockReturnValue(createContext({ agents: [], currentAgentId: '' }));
  mockUseConnections.mockReturnValue({ activeConnectionId: null, roster: [] });
  const none = render(<ChatAppearanceScreen onBack={jest.fn()} />);
  expect(none.getByTestId('chat-appearance-preview-card').props.agent).toBeNull();
});

it('previews a color draft locally and commits it only on Save', async () => {
  mockSetAccentId.mockClear();
  mockUseAppContext.mockReturnValue(createContext());
  const onBack = jest.fn();
  const view = render(<ChatAppearanceScreen onBack={onBack} />);
  fireEvent.press(view.getByTestId('chat-theme-color-rosePink'));
  expect(view.getByTestId('chat-appearance-preview-card').props.accentId).toBe('rosePink');
  expect(mockSetAccentId).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('chat-appearance-back'));
  fireEvent.press(view.getByText('Keep Editing'));
  expect(mockSetAccentId).not.toHaveBeenCalled();
  fireEvent.press(view.getByText('Save'));
  await waitFor(() => expect(onBack).toHaveBeenCalledTimes(1));
  expect(mockSetAccentId).toHaveBeenCalledWith('rosePink');
});

it('discards a color draft without changing the saved accent', () => {
  mockSetAccentId.mockClear();
  mockUseAppContext.mockReturnValue(createContext());
  const onBack = jest.fn();
  const view = render(<ChatAppearanceScreen onBack={onBack} />);
  fireEvent.press(view.getByTestId('chat-theme-color-rosePink'));
  fireEvent.press(view.getByTestId('chat-appearance-back'));
  fireEvent.press(view.getByText('Discard'));
  expect(onBack).toHaveBeenCalledTimes(1);
  expect(mockSetAccentId).not.toHaveBeenCalled();
});
