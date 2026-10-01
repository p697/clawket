import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ModelSheet, type ModelSheetProps } from './ModelSheet';
import type { ModelInfo } from './ModelPickerModal';

const mockBackHandlers: Array<() => boolean> = [];
const mockScrollTo = jest.fn();
// `var`: theme tokens read Platform while modules load, before `let` bindings exist.
// eslint-disable-next-line no-var
var mockPlatform: string | undefined;
let mockSheetProps: Record<string, unknown> = {};
let mockLabels: Record<string, string> = {};

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: Record<string, unknown> & { children?: React.ReactNode }, ref: React.Ref<unknown>) => ReactRuntime.createElement(name,
      { ...props, ref, ...(name === 'Pressable' ? { onStartShouldSetResponder: () => !props.disabled } : {}) }, children),
  );
  return {
    get Platform() { const os = mockPlatform ?? 'ios'; return { OS: os, select: (values: Record<string, unknown>) => values[os] ?? values.default }; },
    BackHandler: { addEventListener: (_event: string, handler: () => boolean) => {
      mockBackHandlers.push(handler);
      return { remove: () => { mockBackHandlers.splice(mockBackHandlers.indexOf(handler), 1); } };
    } },
    useWindowDimensions: () => ({ width: 390, height: 844, fontScale: 1 }),
    ActivityIndicator: primitive('ActivityIndicator'), Pressable: primitive('Pressable'), Text: primitive('Text'),
    TextInput: primitive('TextInput'), View: primitive('View'),
    StyleSheet: { create: (value: unknown) => value, flatten: (value: unknown) => value, hairlineWidth: 1 },
  };
});
jest.mock('@gorhom/bottom-sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    BottomSheetScrollView: ReactRuntime.forwardRef(({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => {
      ReactRuntime.useImperativeHandle(ref, () => ({ scrollTo: mockScrollTo }));
      return ReactRuntime.createElement(View, props, children);
    }),
    BottomSheetSectionList: ({ sections, renderItem, renderSectionHeader, ListEmptyComponent, ...props }: {
      sections: Array<{ key: string; data: unknown[] }>;
      renderItem: (value: { item: unknown; index: number; section: unknown }) => React.ReactNode;
      renderSectionHeader: (value: { section: unknown }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
    } & Record<string, unknown>) => ReactRuntime.createElement(View, props, sections.length === 0 ? ListEmptyComponent : sections.flatMap((section) => [
      ReactRuntime.createElement(ReactRuntime.Fragment, { key: `${section.key}-header` }, renderSectionHeader({ section })),
      ...section.data.map((item, index) => ReactRuntime.createElement(ReactRuntime.Fragment, { key: `${section.key}-${index}` }, renderItem({ item, index, section }))),
    ])),
  };
});
jest.mock('react-native-reanimated', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: { View },
    Easing: { out: (value: unknown) => value, cubic: 'cubic' },
    FadeIn: { duration: () => 'fade-in' },
    useAnimatedStyle: (factory: () => unknown) => factory(),
    useReducedMotion: () => false,
    useSharedValue: (value: unknown) => ({ value }),
    withTiming: (value: unknown) => value,
  };
});
jest.mock('lucide-react-native', () => new Proxy({}, { get: (_target, name) => (props: unknown) => require('react').createElement(String(name), props) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => mockLabels[key] ?? key }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { scheme: 'light', chatColors: { accent: 'conversation-accent' }, colors: {
  ink: 'ink', inkSecondary: 'secondary', inkTertiary: 'tertiary', line: 'line', accent: 'interface-accent', canvas: 'canvas', canvasGrouped: 'grouped',
  surface: 'surface', surfaceFloating: 'card', warn: 'warn', bad: 'bad',
} } }) }));
jest.mock('../../services/haptics', () => ({ triggerLightImpact: jest.fn() }));
jest.mock('../ui/Sheet', () => ({ Sheet: ({ children, visible, headerLeading, titleContent, headerRight, ...props }: Record<string, unknown> & { children: React.ReactNode; visible: boolean }) => {
  mockSheetProps = props;
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return visible ? ReactRuntime.createElement(View, { testID: props.testID }, headerLeading, titleContent, headerRight, children) : null;
} }));
jest.mock('../ui/SearchInput', () => ({ SearchInput: ({ testID, value, onChangeText, placeholder }: Record<string, unknown>) => require('react').createElement('TextInput', { testID, value, onChangeText, placeholder }) }));
jest.mock('../ui/SettingsGroup', () => {
  const ReactRuntime = require('react');
  return {
    SettingsGroup: ({ children, testID }: { children: React.ReactNode; testID?: string }) => ReactRuntime.createElement('SettingsGroup', { testID }, children),
    SettingsDivider: () => ReactRuntime.createElement('SettingsDivider'),
  };
});
jest.mock('../ui/SheetHeaderButton', () => ({ SheetHeaderButton: (props: Record<string, unknown>) => require('react').createElement('Pressable', props) }));
jest.mock('../ui/SheetHeaderSpinner', () => ({ SheetHeaderSpinner: (props: Record<string, unknown>) => require('react').createElement('SheetHeaderSpinner', props) }));
jest.mock('../ui/ThemedSwitch', () => ({ ThemedSwitch: (props: Record<string, unknown>) => require('react').createElement('Switch', props) }));
jest.mock('../ui/DirectionalIcon', () => ({ ChevronLeft: () => null, ChevronRight: () => null }));
jest.mock('../ui/ListSkeleton', () => ({ ListSkeleton: (props: Record<string, unknown>) => require('react').createElement('ListSkeleton', props) }));
jest.mock('./ModelIcon', () => ({ ModelIcon: () => null }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) }));

const catalog: ModelInfo[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((id, index) => ({ id, name: `Model ${id.toUpperCase()}`, provider: 'openai', sortOrder: index }));

function props(overrides: Partial<ModelSheetProps> = {}): ModelSheetProps {
  return {
    visible: true, scope: 'session', writes: 'optimistic', loading: false, error: null, models: catalog,
    currentModel: 'e', currentProvider: 'openai',
    onClose: jest.fn(), onRetry: jest.fn(), onSelectModel: jest.fn(), ...overrides,
  };
}

function native(overrides: Partial<ModelSheetProps> = {}): ModelSheetProps {
  return props({
    writes: 'native', busy: false, permissionsSupported: true,
    models: [{ id: 'native-alias', name: 'Native model', provider: 'provider', resolvedModel: 'resolved-model' }],
    currentModel: 'native-alias', currentProvider: 'provider',
    thinking: { current: 'high', options: ['low', 'high'], onSelect: jest.fn() },
    fastMode: { enabled: null, available: true }, onSelectFastMode: jest.fn(),
    permissions: { mode: 'custom', available: true, scope: 'session', availableModes: ['workspace', 'full-access'] },
    onSelectPermissions: jest.fn(),
    ...overrides,
  });
}

const rowIds = (view: ReturnType<typeof render>) => view.getAllByTestId(/^model-sheet-model-/)
  .map((row) => String(row.props.testID)).filter((id) => !/-(selected|pending|default)$/.test(id));

beforeEach(() => {
  mockBackHandlers.length = 0;
  mockScrollTo.mockClear();
  mockPlatform = 'ios';
  mockLabels = { thinking_low: '低', thinking_medium: '中', thinking_high: '高', thinking_xhigh: '极高', 'Thinking Level': '思考等级' };
});

describe('first page models', () => {
  it('offers the current model, then recent ones, then the catalog order, with the rest behind All N models', () => {
    const view = render(<ModelSheet {...props({ recentModels: ['openai/c'] })} />);
    expect(rowIds(view)).toEqual(['model-sheet-model-openai:e', 'model-sheet-model-openai:c', 'model-sheet-model-openai:a']);
    expect(view.getByTestId('model-sheet-model-openai:e-selected')).toBeTruthy();
    expect(view.getByText('All {{count}} models')).toBeTruthy();
    expect(view.getByTestId('model-sheet-scope').props.children).toBe('Only for this conversation');
  });

  it('keeps the rows still while the check moves, and puts a catalog pick first on return', () => {
    const callbacks = props();
    const view = render(<ModelSheet {...callbacks} />);
    fireEvent.press(view.getByTestId('model-sheet-model-openai:b'));
    expect(callbacks.onSelectModel).toHaveBeenCalledWith(catalog[1]);
    // The write reads the same catalog back as a new array and records a recent model: the rows hold still.
    view.rerender(<ModelSheet {...callbacks} currentModel="b" models={catalog.map((model) => ({ ...model }))} recentModels={['openai/b']} />);
    expect(rowIds(view)).toEqual(['model-sheet-model-openai:e', 'model-sheet-model-openai:a', 'model-sheet-model-openai:b']);
    expect(view.getByTestId('model-sheet-model-openai:b-selected')).toBeTruthy();
    // The full catalog is a second page; picking there returns to the first page with the pick first.
    fireEvent.press(view.getByTestId('model-sheet-all-models'));
    expect(mockSheetProps.snapPoints).toEqual(['92%']);
    expect(view.queryByTestId('model-sheet-overview')).toBeNull();
    fireEvent.press(view.getByTestId('model-sheet-catalog-openai:f'));
    expect(callbacks.onSelectModel).toHaveBeenLastCalledWith(catalog[5]);
    expect(view.getByTestId('model-sheet-overview')).toBeTruthy();
    expect(mockSheetProps.snapPoints).toBeUndefined();
    expect(rowIds(view)[0]).toBe('model-sheet-model-openai:f');
  });

  it('pins the current model above the provider groups and searches the rest', () => {
    const view = render(<ModelSheet {...props({ models: [...catalog, { id: 'x', name: 'Other X', provider: 'anthropic' }] })} />);
    fireEvent.press(view.getByTestId('model-sheet-all-models'));
    expect(view.getByText('Current')).toBeTruthy();
    expect(view.getAllByTestId('model-sheet-catalog-openai:e')).toHaveLength(1);
    expect(view.getByText('OpenAI')).toBeTruthy();
    expect(view.getByTestId('model-sheet-catalog').props.removeClippedSubviews).toBe(false);
    fireEvent.changeText(view.getByTestId('model-sheet-search'), 'other');
    expect(view.queryByText('Current')).toBeNull();
    expect(view.getByTestId('model-sheet-catalog-anthropic:x')).toBeTruthy();
    expect(view.queryByTestId('model-sheet-catalog-openai:a')).toBeNull();
  });

  it('returns from the catalog with its leading Back and with the Android Back key', () => {
    mockPlatform = 'android';
    const callbacks = props();
    const view = render(<ModelSheet {...callbacks} />);
    fireEvent.press(view.getByTestId('model-sheet-all-models'));
    expect(view.getByTestId('model-sheet-back').props.accessibilityLabel).toBe('Back');
    expect(mockBackHandlers).toHaveLength(1);
    expect(mockBackHandlers[0]!()).toBe(true);
    view.rerender(<ModelSheet {...callbacks} />);
    expect(view.getByTestId('model-sheet-overview')).toBeTruthy();
    expect(mockBackHandlers).toHaveLength(0);
    expect(callbacks.onClose).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('model-sheet-all-models'));
    fireEvent.press(view.getByTestId('model-sheet-back'));
    expect(view.getByTestId('model-sheet-overview')).toBeTruthy();
  });

  it('lists a small catalog whole, without a second page', () => {
    const view = render(<ModelSheet {...props({ models: catalog.slice(0, 4), currentModel: 'b' })} />);
    expect(rowIds(view)).toHaveLength(4);
    expect(view.queryByTestId('model-sheet-all-models')).toBeNull();
  });

  it('tags the Agent default and names a global choice', () => {
    const view = render(<ModelSheet {...props({ scope: 'global', configuredDefaultModel: 'OPENAI/a' })} />);
    expect(view.getByTestId('model-sheet-model-openai:a-default').props.children).toBe('Default');
    expect(view.getByTestId('model-sheet-scope').props.children).toBe('Shared by all conversations');
  });

  it('opens model management only after the sheet has closed', () => {
    const onManage = jest.fn();
    const callbacks = props({ onManage });
    const view = render(<ModelSheet {...callbacks} />);
    fireEvent.press(view.getByTestId('model-sheet-manage'));
    expect(callbacks.onClose).toHaveBeenCalledTimes(1);
    expect(onManage).not.toHaveBeenCalled();
    (mockSheetProps.onAfterClose as () => void)();
    expect(onManage).toHaveBeenCalledTimes(1);
  });

  it('sizes a short first page to its content and gives native settings a fixed detent from the start', () => {
    render(<ModelSheet {...props()} />);
    expect(mockSheetProps.snapPoints).toBeUndefined();
    expect(mockSheetProps.contentStyle).toEqual({ flexShrink: 1, minHeight: 0 });
    render(<ModelSheet {...native()} />);
    expect(mockSheetProps.snapPoints).toEqual(['90%']);
    expect(mockSheetProps.contentStyle).toBeUndefined();
  });

  it('keeps a content-sized first page from shrinking while it is open', () => {
    const view = render(<ModelSheet {...props()} />);
    const overview = () => view.getByTestId('model-sheet-overview');
    const minHeight = () => Object.assign({}, ...[overview().props.style].flat()).minHeight;
    fireEvent(overview(), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 500 } } });
    expect(minHeight()).toBe(500);
    // The adaptive caption leaves: the room stays at the bottom until the sheet has gone.
    fireEvent(overview(), 'layout', { nativeEvent: { layout: { x: 0, y: 0, width: 390, height: 470 } } });
    expect(minHeight()).toBe(500);
    act(() => (mockSheetProps.onAfterClose as () => void)());
    expect(minHeight()).toBe(0);
  });

  it('moves a first page that outgrows the sheet to the scrolling detent until the sheet has gone', () => {
    jest.useFakeTimers();
    try {
      const view = render(<ModelSheet {...props()} />);
      const layout = (testID: string, height: number) => fireEvent(view.getByTestId(testID), 'layout',
        { nativeEvent: { layout: { x: 0, y: 0, width: 390, height } } });
      // The content grows first and its frame follows in the same batch: no overflow.
      layout('model-sheet-overview-content', 520);
      layout('model-sheet-overview', 520 + 16);
      act(() => { jest.runOnlyPendingTimers(); });
      expect(mockSheetProps.snapPoints).toBeUndefined();
      // The sheet's limit holds the frame shorter than its content.
      layout('model-sheet-overview-content', 760);
      layout('model-sheet-overview', 640);
      act(() => { jest.runOnlyPendingTimers(); });
      expect(mockSheetProps.snapPoints).toEqual(['90%']);
      expect(mockSheetProps.contentStyle).toBeUndefined();
      act(() => (mockSheetProps.onAfterClose as () => void)());
      expect(mockSheetProps.snapPoints).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  it('stands in placeholder rows for a first catalog read instead of calling it empty', () => {
    const view = render(<ModelSheet {...props({ models: [], currentModel: undefined, loading: true })} />);
    expect(view.getByTestId('model-sheet-model-loading')).toBeTruthy();
    view.rerender(<ModelSheet {...props({ models: [], currentModel: undefined })} />);
    expect(view.queryByTestId('model-sheet-model-loading')).toBeNull();
    expect(view.getByText('No models available')).toBeTruthy();
  });
});

describe('native settings (Codex)', () => {
  it('shows the resolved native model and the conversation facts, which are never pressable', () => {
    const view = render(<ModelSheet {...native({ contextRemainingPercent: 54, project: { label: '~/repo', path: '/Users/lucy/repo' } })} />);
    expect(view.getByText('resolved-model')).toBeTruthy();
    expect(view.getByText('Model settings')).toBeTruthy();
    const context = view.getByTestId('model-sheet-context');
    expect(context.props.onPress).toBeUndefined();
    expect(context.props.accessibilityLabel).toBe('Context remaining: {{percent}}%');
    const project = view.getByTestId('model-sheet-project');
    expect(project.props.accessibilityLabel).toBe('Project: /Users/lucy/repo');
    expect(project.props.ellipsizeMode).toBe('middle');
  });

  it('does not flip Fast before the computer confirms it, and spins in its place while applying', () => {
    const callbacks = native({ fastMode: { enabled: false, available: true } });
    const view = render(<ModelSheet {...callbacks} />);
    fireEvent(view.getByTestId('model-sheet-fast-switch'), 'valueChange', true);
    expect(callbacks.onSelectFastMode).toHaveBeenCalledWith(true);
    expect(view.getByTestId('model-sheet-fast-switch').props.value).toBe(false);
    view.rerender(<ModelSheet {...callbacks} busy />);
    expect(view.getByTestId('model-sheet-fast-pending')).toBeTruthy();
    expect(view.queryByTestId('model-sheet-waiting')).toBeNull();
    expect(view.getByTestId('model-sheet-permission-full-access').props.accessibilityState.disabled).toBe(true);
    view.rerender(<ModelSheet {...callbacks} fastMode={{ enabled: true, available: true }} />);
    expect(view.queryByTestId('model-sheet-fast-pending')).toBeNull();
    expect(view.getByTestId('model-sheet-fast-switch').props.value).toBe(true);
  });

  it('hides speed when the selected native model does not advertise it', () => {
    const view = render(<ModelSheet {...native({ fastMode: { enabled: null, available: false } })} />);
    expect(view.queryByTestId('model-sheet-fast')).toBeNull();
  });

  it('spins in the model row whose write is in flight and keeps its check on the confirmed model', () => {
    const models = [...catalog.slice(0, 2)];
    const callbacks = native({ models, currentModel: 'a', currentProvider: 'openai' });
    const view = render(<ModelSheet {...callbacks} />);
    fireEvent.press(view.getByTestId('model-sheet-model-openai:b'));
    view.rerender(<ModelSheet {...callbacks} busy />);
    expect(view.getByTestId('model-sheet-model-openai:b-pending')).toBeTruthy();
    expect(view.getByTestId('model-sheet-model-openai:a-selected')).toBeTruthy();
    expect(view.getByTestId('model-sheet-model-openai:b').props.accessibilityState).toMatchObject({ busy: true, checked: false, disabled: true });
  });

  it('shows a write that started elsewhere in the header, at once, and a refresh quietly', () => {
    const view = render(<ModelSheet {...native({ busy: true })} />);
    expect(view.getByTestId('model-sheet-waiting').props).toMatchObject({ accessibilityLabel: 'Applying settings…', immediate: true });
    view.rerender(<ModelSheet {...native({ loading: true })} />);
    expect(view.getByTestId('model-sheet-waiting').props).toMatchObject({ accessibilityLabel: 'Loading...', immediate: false });
    // A refresh keeps the rows on screen usable.
    expect(view.getByTestId('model-sheet-model-provider:native-alias').props.accessibilityState.disabled).toBe(false);
  });

  it('locks every choice while a run is in progress and offers Stop', () => {
    const onStopRun = jest.fn();
    const view = render(<ModelSheet {...native({ running: true, onStopRun })} />);
    expect(view.getByText('This turn is still running. Settings can change when it ends.')).toBeTruthy();
    fireEvent.press(view.getByTestId('model-sheet-stop'));
    expect(onStopRun).toHaveBeenCalledTimes(1);
    expect(view.getByTestId('model-sheet-model-provider:native-alias').props.accessibilityState.disabled).toBe(true);
    expect(view.getByTestId('model-sheet-thinking-low').props.accessibilityState.disabled).toBe(true);
  });
});

describe('thinking', () => {
  it('slides between a few short levels beside the label and spins in the asking segment', () => {
    const onSelect = jest.fn();
    const callbacks = native({ thinking: { current: 'high', options: ['low', 'medium', 'high', 'xhigh'], onSelect } });
    const view = render(<ModelSheet {...callbacks} />);
    expect(view.getByTestId('model-sheet-thinking-high').props.accessibilityState).toMatchObject({ checked: true });
    fireEvent.press(view.getByTestId('model-sheet-thinking-low'));
    expect(onSelect).toHaveBeenCalledWith('low');
    view.rerender(<ModelSheet {...callbacks} busy />);
    expect(view.getByTestId('model-sheet-thinking-low-pending')).toBeTruthy();
    expect(view.getByTestId('model-sheet-thinking-high').props.accessibilityState.checked).toBe(true);
  });

  it('waits for an optimistic backend to report the level, then explains adaptive thinking', () => {
    const onSelect = jest.fn();
    const callbacks = props({ thinking: { current: 'low', options: ['adaptive', 'off', 'low', 'high'], onSelect } });
    mockLabels = { ...mockLabels, thinking_adaptive: '自适应', thinking_off: '关闭' };
    const view = render(<ModelSheet {...callbacks} />);
    fireEvent.press(view.getByTestId('model-sheet-thinking-adaptive'));
    expect(onSelect).toHaveBeenCalledWith('adaptive');
    expect(view.getByTestId('model-sheet-thinking-adaptive-pending')).toBeTruthy();
    view.rerender(<ModelSheet {...callbacks} thinking={{ current: 'adaptive', options: ['adaptive', 'off', 'low', 'high'], onSelect }} />);
    expect(view.queryByTestId('model-sheet-thinking-adaptive-pending')).toBeNull();
    expect(view.getByTestId('model-sheet-thinking-caption').props.children).toBe('Adaptive: the model decides how long to think.');
  });

  it('wraps long translated levels as chips instead of squeezing segments', () => {
    mockLabels = { thinking_adaptive: 'Adaptive', thinking_off: 'Off', thinking_minimal: 'Minimal', thinking_low: 'Low', thinking_medium: 'Medium', thinking_high: 'High', thinking_xhigh: 'Extra High' };
    const view = render(<ModelSheet {...props({ thinking: { current: 'high', options: ['adaptive', 'off', 'minimal', 'low', 'medium', 'high', 'xhigh'], onSelect: jest.fn() } })} />);
    expect(view.getByText('Extra High')).toBeTruthy();
    expect(view.getByTestId('model-sheet-thinking-high').props.accessibilityState.checked).toBe(true);
    expect(view.getByText('Thinking Level')).toBeTruthy();
  });
});

describe('permissions (Codex)', () => {
  it('offers only the native allowed modes, least first, and names confirmed custom settings', () => {
    const callbacks = native();
    const view = render(<ModelSheet {...callbacks} />);
    expect(view.queryByTestId('model-sheet-permission-read-only')).toBeNull();
    expect(view.getByTestId('model-sheet-permission-workspace').props.accessibilityState.checked).toBe(false);
    expect(view.getByTestId('model-sheet-permission-status').props.children).toBe('Computer settings');
    fireEvent.press(view.getByTestId('model-sheet-permission-full-access'));
    expect(callbacks.onSelectPermissions).toHaveBeenCalledWith('full-access');
  });

  it('opens a required permission choice without marking an unconfirmed native mode as accepted', () => {
    const callbacks = native({ permissions: { mode: 'full-access', available: true, scope: 'session', requiresConfirmation: true } });
    const view = render(<ModelSheet {...callbacks} />);
    expect(view.getByText('Choose permissions again before sending.')).toBeTruthy();
    expect(view.getByTestId('model-sheet-permission-full-access').props.accessibilityState).toMatchObject({ checked: false, disabled: false });
    fireEvent.press(view.getByTestId('model-sheet-permission-full-access'));
    expect(callbacks.onSelectPermissions).toHaveBeenCalledWith('full-access');
    view.rerender(<ModelSheet {...callbacks} permissions={{ mode: 'full-access', available: true, scope: 'session', requiresConfirmation: false }} />);
    expect(view.queryByText('Choose permissions again before sending.')).toBeNull();
    expect(view.getByTestId('model-sheet-permission-full-access').props.accessibilityState.checked).toBe(true);
    expect(view.getByTestId('model-sheet-permission-full-access-selected').props.color).toBe('warn');
  });

  it('warns about a plaintext transport and explains unavailability through a refresh', () => {
    const unavailable = native({ permissions: { mode: 'workspace', available: false, scope: 'session', unencryptedTransport: true } });
    const view = render(<ModelSheet {...unavailable} />);
    expect(view.getByText('This connection is not encrypted. Use a trusted network or switch to Relay.')).toBeTruthy();
    const notice = 'Permission changes are unavailable for this conversation. Check Codex on your computer.';
    expect(view.getByText(notice)).toBeTruthy();
    view.rerender(<ModelSheet {...unavailable} loading />);
    expect(view.getByText(notice)).toBeTruthy();
    view.rerender(<ModelSheet {...unavailable} permissions={{ mode: 'workspace', available: true, scope: 'session' }} />);
    expect(view.queryByText(notice)).toBeNull();
  });

  it.each([undefined, { mode: null, available: false, scope: 'session' } as const])('offers one manual read retry for unknown permissions %j without selecting a permission', (permissions) => {
    const callbacks = native({ permissions });
    const view = render(<ModelSheet {...callbacks} />);
    expect(view.getByTestId('model-sheet-permission-status')).toBeTruthy();
    expect(view.getByText('Unknown')).toBeTruthy();
    expect(view.getAllByText('Retry')).toHaveLength(1);
    for (const mode of ['workspace', 'read-only', 'full-access']) {
      expect(view.getByTestId(`model-sheet-permission-${mode}`).props.accessibilityState.checked).toBe(false);
    }
    const unavailable = view.queryByText('Permission changes are unavailable for this conversation. Check Codex on your computer.');
    if (permissions === undefined) expect(unavailable).toBeNull();
    else expect(unavailable).toBeTruthy();
    fireEvent.press(view.getByTestId('model-sheet-permissions-retry'));
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
    expect(callbacks.onSelectPermissions).not.toHaveBeenCalled();
  });

  it('waits for the first permission read without calling it unknown or offering a retry', () => {
    const callbacks = native({ permissions: undefined, loading: true });
    const view = render(<ModelSheet {...callbacks} />);
    expect(view.queryByText('Unknown')).toBeNull();
    expect(view.queryByTestId('model-sheet-permissions-retry')).toBeNull();
    fireEvent.press(view.getByTestId('model-sheet-permission-full-access'));
    expect(callbacks.onSelectPermissions).not.toHaveBeenCalled();
    view.rerender(<ModelSheet {...callbacks} loading={false} />);
    expect(view.getByText('Unknown')).toBeTruthy();
    expect(view.getByTestId('model-sheet-permissions-retry').props.accessibilityState.disabled).toBe(false);
  });

  it.each(['busy', 'running'] as const)('keeps the unknown permission retry disabled during %s', (state) => {
    const callbacks = native({ permissions: undefined, [state]: true });
    const view = render(<ModelSheet {...callbacks} />);
    expect(view.getByTestId('model-sheet-permissions-retry').props.accessibilityState.disabled).toBe(true);
    fireEvent.press(view.getByTestId('model-sheet-permissions-retry'));
    expect(callbacks.onRetry).not.toHaveBeenCalled();
    expect(view.queryByText('Permission changes are unavailable for this conversation. Check Codex on your computer.')).toBeNull();
  });

  it('keeps exactly one retry when an initial read fails', () => {
    const callbacks = native({ permissions: undefined, error: 'Read failed' });
    const view = render(<ModelSheet {...callbacks} />);
    expect(view.getByText('Read failed')).toBeTruthy();
    expect(view.queryByTestId('model-sheet-permissions-retry')).toBeNull();
    expect(view.getAllByText('Retry')).toHaveLength(1);
    fireEvent.press(view.getByTestId('model-sheet-error-retry'));
    expect(callbacks.onRetry).toHaveBeenCalledTimes(1);
  });

  it('spins in the permission row whose write is in flight', () => {
    const callbacks = native();
    const view = render(<ModelSheet {...callbacks} />);
    fireEvent.press(view.getByTestId('model-sheet-permission-workspace'));
    view.rerender(<ModelSheet {...callbacks} busy />);
    expect(view.getByTestId('model-sheet-permission-workspace-pending')).toBeTruthy();
    expect(view.getByTestId('model-sheet-permission-workspace').props.accessibilityState).toMatchObject({ busy: true, checked: false, disabled: true });
  });

  it('starts at the permission choices when a permission prompt opened the sheet', () => {
    jest.useFakeTimers();
    try {
      const view = render(<ModelSheet {...native({ focusPermissions: true })} />);
      const layout = { nativeEvent: { layout: { x: 0, y: 420, width: 358, height: 240 } } };
      fireEvent(view.getByTestId('model-sheet-permissions'), 'layout', layout);
      jest.runAllTimers();
      expect(mockScrollTo).toHaveBeenCalledWith({ y: 404, animated: true });
      // Once per opening: a later layout pass leaves the reader where they scrolled.
      fireEvent(view.getByTestId('model-sheet-permissions'), 'layout', layout);
      jest.runAllTimers();
      expect(mockScrollTo).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
