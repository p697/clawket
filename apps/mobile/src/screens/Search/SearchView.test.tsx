import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { FontSize } from '../../theme/tokens';
import type { SearchResult, SearchSection } from './model';
import { SearchView, type SearchViewProps } from './SearchView';

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
  good: '#178A6A',
  goodSoft: '#E4F3EE',
  warn: '#D9791C',
  warnSoft: '#FAEDE1',
  bad: '#D64545',
  badSoft: '#F9E7E7',
};

const darkColors = {
  ...lightColors,
  canvas: '#0C0C0D',
  canvasGrouped: '#0C0C0D',
  surface: '#1A1A1D',
  surfaceFloating: '#222225',
  ink: '#F3F3F5',
  inkSecondary: '#9A9AA3',
  inkTertiary: '#6A6A73',
  line: '#2A2A2F',
  accent: '#6B95FF',
  accentSoft: '#1B2947',
  good: '#2FA07C',
  goodSoft: '#17352C',
  warn: '#D07F30',
  warnSoft: '#3A2B1E',
  bad: '#E06060',
  badSoft: '#3B2224',
};

let mockTheme = { scheme: 'light' as 'light' | 'dark', colors: lightColors };

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
  return {
    Pressable: host('Pressable'),
    ScrollView: host('ScrollView'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => flattenStyle(style),
      hairlineWidth: 1,
    },
    Text: host('Text'),
    TextInput: host('TextInput'),
    View: host('View'),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (props: Record<string, unknown>) => ReactRuntime.createElement('Icon', props);
  return new Proxy({}, { get: () => icon });
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => key.replace(
      '{{code}}',
      String(options?.code ?? ''),
    ),
  }),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({ theme: mockTheme }),
}));

jest.mock('../../components/ui/AgentAvatar', () => ({
  AgentAvatar: (props: Record<string, unknown>) => React.createElement('AgentAvatar', props),
}));

jest.mock('../../components/ui/Banner', () => ({
  Banner: ({ actionLabel, onAction, ...props }: Record<string, unknown>) => React.createElement(
    'Banner',
    props,
    actionLabel ? React.createElement('Pressable', { testID: `${String(props.testID)}-action`, onPress: onAction }, String(actionLabel)) : null,
  ),
}));

jest.mock('../../components/ui/FloatingButton', () => ({
  FloatingButton: ({ onPress, ...props }: Record<string, unknown>) => React.createElement(
    'Pressable',
    { ...props, onPress },
  ),
}));

jest.mock('../../components/ui/SearchInput', () => ({
  SearchInput: ({ onChangeText, ...props }: Record<string, unknown>) => React.createElement(
    'TextInput',
    { ...props, onChangeText },
  ),
}));

jest.mock('../../components/ui/SegmentedTabs', () => ({
  SegmentedTabs: ({ tabs, onSwitch, testID }: {
    tabs: ReadonlyArray<{ key: string; label: string }>;
    onSwitch: (key: string) => void;
    testID: string;
  }) => React.createElement(
    'View',
    { testID },
    tabs.map((tab) => React.createElement(
      'Pressable',
      { key: tab.key, testID: `${testID}-${tab.key}`, onPress: () => onSwitch(tab.key) },
      tab.label,
    )),
  ),
}));

jest.mock('../../components/ui/Skeleton', () => ({
  Skeleton: (props: Record<string, unknown>) => React.createElement('Skeleton', props),
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
      const fontSize = flattenStyle(node.props.style).fontSize;
      if (typeof fontSize === 'number') sizes.add(fontSize);
    });
  return [...sizes].sort((left, right) => left - right);
}

function result(kind: SearchResult['kind'], patch: Partial<SearchResult> = {}): SearchResult {
  const base = {
    id: `${kind}-id`,
    connectionId: 'connection',
    agentId: 'agent',
    sessionKey: 'session',
    title: `${kind} launch`,
    subtitle: 'Home server',
    updatedAt: 100,
    source: 'cache' as const,
  };
  if (kind === 'agent') return { ...base, kind, ...patch } as SearchResult;
  if (kind === 'session') return { ...base, kind, ...patch } as SearchResult;
  if (kind === 'favorite') {
    return {
      ...base,
      kind,
      favoriteKey: 'favorite-key',
      messageId: 'favorite-message',
      text: 'Favorite launch copy',
      ...patch,
    } as SearchResult;
  }
  return {
    ...base,
    kind,
    messageId: 'message-id',
    text: 'Local launch copy',
    ...patch,
  } as SearchResult;
}

const sections: SearchSection[] = [
  { kind: 'agents', results: [result('agent')] },
  { kind: 'sessions', results: [result('session')] },
  { kind: 'messages', results: [result('message', { lockedReason: 'messageHistory' })] },
  { kind: 'favorites', results: [result('favorite')] },
];

function props(patch: Partial<SearchViewProps> = {}): SearchViewProps {
  return {
    state: 'ready',
    query: 'launch',
    filter: 'all',
    sections,
    recentSearches: [],
    availableResultCount: 4,
    topInset: 24,
    bottomInset: 16,
    onBack: jest.fn(),
    onChangeQuery: jest.fn(),
    onChangeFilter: jest.fn(),
    onSelectResult: jest.fn(),
    onSelectRecent: jest.fn(),
    onRetry: jest.fn(),
    onOpenPermission: jest.fn(),
    ...patch,
  };
}

describe('SearchView', () => {
  let consoleErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    mockTheme = { scheme: 'light', colors: lightColors };
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation((message?: unknown) => {
      if (typeof message === 'string' && message.includes('react-test-renderer is deprecated')) return;
    });
  });

  afterEach(() => consoleErrorSpy.mockRestore());

  it('renders all four result sections and routes row presses through one callback', () => {
    const onSelectResult = jest.fn();
    const view = render(<SearchView {...props({ onSelectResult })} />);

    expect(view.getByTestId('search-section-agents')).toBeTruthy();
    expect(view.getByTestId('search-section-sessions')).toBeTruthy();
    expect(view.getByTestId('search-section-messages')).toBeTruthy();
    expect(view.getByTestId('search-section-favorites')).toBeTruthy();
    expect(view.getByTestId('search-result-lock-message-id')).toBeTruthy();

    fireEvent.press(view.getByTestId('search-result-agent-agent-id'));
    expect(onSelectResult).toHaveBeenCalledWith(expect.objectContaining({ kind: 'agent' }));
  });

  it('auto-focuses the input and adapts the canvas to light and dark themes', () => {
    const first = render(<SearchView {...props()} />);
    expect(first.getByTestId('search-input').props.autoFocus).toBe(true);
    expect(flattenStyle(first.getByTestId('search-view').props.style).backgroundColor).toBe('#FFFFFF');

    mockTheme = { scheme: 'dark', colors: darkColors };
    first.rerender(<SearchView {...props()} />);
    expect(flattenStyle(first.getByTestId('search-view').props.style).backgroundColor).toBe('#0C0C0D');
  });

  it('keeps the visible copy within the search typography budget and result rows borderless', () => {
    const view = render(<SearchView {...props()} />);

    expect(renderedFontSizes(view)).toEqual([
      FontSize.caption,
      FontSize.secondary,
      FontSize.body,
    ].sort((left, right) => left - right));
    sections.flatMap((section) => section.results).forEach((entry) => {
      const style = flattenStyle(
        view.getByTestId(`search-result-${entry.kind}-${entry.id}`).props.style,
      );
      expect(style.borderWidth).toBeUndefined();
    });
  });

  it('renders recent searches for an empty query and restores one on press', () => {
    const onSelectRecent = jest.fn();
    const view = render(<SearchView {...props({
      query: '',
      sections: [],
      recentSearches: ['Hermes sessions'],
      onSelectRecent,
    })} />);

    fireEvent.press(view.getByTestId('search-recent-Hermes sessions'));
    expect(onSelectRecent).toHaveBeenCalledWith('Hermes sessions');
  });

  it('shows no more than three filters for long result lists', () => {
    const onChangeFilter = jest.fn();
    const view = render(<SearchView {...props({
      availableResultCount: 7,
      onChangeFilter,
    })} />);

    expect(view.getByTestId('search-filters').children).toHaveLength(3);
    fireEvent.press(view.getByTestId('search-filters-favorites'));
    expect(onChangeFilter).toHaveBeenCalledWith('favorites');
  });

  it.each([
    ['loading', 'search-loading'],
    ['empty', 'search-empty'],
    ['error', 'search-error'],
    ['offline', 'search-offline'],
    ['permission', 'search-permission'],
  ] as const)('renders the %s state', (state, testID) => {
    const view = render(<SearchView {...props({
      state,
      query: state === 'empty' ? 'missing' : 'launch',
      sections: state === 'offline' || state === 'error' ? sections : [],
      errorCode: state === 'error' ? 'network' : null,
    })} />);
    expect(view.getByTestId(testID)).toBeTruthy();
  });

  it('shows the recovery window as a quiet capsule ahead of cached results', () => {
    const view = render(<SearchView {...props({
      state: 'offline',
      reconnecting: true,
      query: 'launch',
      sections,
    })} />);
    expect(view.getByTestId('search-reconnecting')).toBeTruthy();
    expect(view.queryByTestId('search-offline')).toBeNull();
    expect(view.queryByTestId('search-reconnecting-action')).toBeNull();
    expect(view.getByTestId('search-sections')).toBeTruthy();
  });

  it('routes header and permission actions without native navigation chrome', () => {
    const onBack = jest.fn();
    const onOpenPermission = jest.fn();
    const view = render(<SearchView {...props({
      state: 'permission',
      sections: [],
      onBack,
      onOpenPermission,
    })} />);

    fireEvent.press(view.getByTestId('search-back'));
    fireEvent.press(view.getByTestId('search-permission-action'));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onOpenPermission).toHaveBeenCalledTimes(1);
  });
});
