import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { triggerLightImpact } from '../../services/haptics';
import { ModelPickerModal, type ModelInfo } from './ModelPickerModal';

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ReactRuntime.forwardRef(
    ({ children, ...props }: { children?: React.ReactNode }, ref: React.Ref<unknown>) => (
      ReactRuntime.createElement(name, { ...props, ref }, children)
    ),
  );
  return {
    Platform: { OS: 'ios' },
    ActivityIndicator: primitive('ActivityIndicator'),
    Image: primitive('Image'),
    Pressable: primitive('Pressable'),
    StyleSheet: {
      create: <T extends Record<string, unknown>>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: primitive('Text'),
    TextInput: primitive('TextInput'),
    View: primitive('View'),
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    BottomSheetSectionList: ({
      sections,
      renderItem,
      renderSectionHeader,
      renderSectionFooter,
      ListEmptyComponent,
      ...props
    }: {
      sections: Array<{ provider: string; data: unknown[] }>;
      renderItem: (value: { item: unknown }) => React.ReactNode;
      renderSectionHeader: (value: { section: unknown }) => React.ReactNode;
      renderSectionFooter: (value: { section: unknown }) => React.ReactNode;
      ListEmptyComponent?: React.ReactNode;
    } & Record<string, unknown>) => ReactRuntime.createElement(
      View,
      { testID: 'model-picker-section-list', ...props },
      sections.flatMap((section) => [
        ReactRuntime.createElement(
          ReactRuntime.Fragment,
          { key: `${section.provider}-header` },
          renderSectionHeader({ section }),
        ),
        ...section.data.map((item, index) => ReactRuntime.createElement(
          ReactRuntime.Fragment,
          { key: `${section.provider}-${index}` },
          renderItem({ item }),
        )),
        ReactRuntime.createElement(
          ReactRuntime.Fragment,
          { key: `${section.provider}-footer` },
          renderSectionFooter({ section }),
        ),
      ]),
      sections.length === 0 ? ListEmptyComponent : null,
    ),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  const icon = (name: string) => (props: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props)
  );
  return {
    Check: icon('Check'),
    Orbit: icon('Orbit'),
    Search: icon('Search'),
    Settings2: icon('Settings2'),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('../../services/haptics', () => ({
  triggerLightImpact: jest.fn(),
}));

jest.mock('../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: '#1677ff',
        ink: '#111111',
        inkSecondary: '#555555',
        inkTertiary: '#888888',
        surface: '#ffffff',
        surfaceFloating: '#f4f4f4',
      },
    },
  }),
}));

jest.mock('../ui', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, TextInput, View } = require('react-native');
  return {
    SheetHeaderButton: (props: Record<string, unknown>) => ReactRuntime.createElement(Pressable, props),
    Button: ({ label, onPress }: { label: string; onPress?: () => void }) => (
      ReactRuntime.createElement(Pressable, { onPress }, label)
    ),
    CompositionSafeBottomSheetTextInput: ReactRuntime.forwardRef(
      (props: Record<string, unknown>, ref: React.Ref<unknown>) => (
        ReactRuntime.createElement(TextInput, {
          ...props,
          ref,
          compositionSafeBottomSheet: true,
        })
      ),
    ),
    Sheet: ({
      children,
      closeAccessibilityLabel,
      onClose,
      testID,
      title,
      headerRight,
      visible,
      ...props
    }: {
      children: React.ReactNode;
      closeAccessibilityLabel: string;
      onClose: () => void;
      testID?: string;
      title?: string;
      visible: boolean;
    } & Record<string, unknown>) => visible ? ReactRuntime.createElement(
      View,
      { ...props, testID: `${testID}-shell`, canonicalSheet: true },
      ReactRuntime.createElement(Text, null, title),
      ReactRuntime.createElement(Pressable, {
        accessibilityLabel: closeAccessibilityLabel,
        onPress: onClose,
        testID: `${testID}-close`,
      }),
      headerRight,
      children,
    ) : null,
  };
});

const models: ModelInfo[] = [
  { id: 'gpt-5-api', name: 'GPT Five', provider: 'openai' },
  { id: 'claude-sonnet', name: 'Claude Sonnet', provider: 'anthropic' },
];

const providers = [
  { slug: 'openai', name: 'OpenAI' },
  { slug: 'anthropic', name: 'Anthropic' },
];

function renderPicker(overrides: Partial<React.ComponentProps<typeof ModelPickerModal>> = {}) {
  const onClose = jest.fn();
  const onSelectModel = jest.fn();
  const view = render(
    <ModelPickerModal
      visible
      onClose={onClose}
      models={models}
      providers={providers}
      loading={false}
      selectedModelId="openai/gpt-5-api"
      onSelectModel={onSelectModel}
      {...overrides}
    />,
  );
  return { ...view, onClose, onSelectModel };
}

describe('ModelPickerModal view', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows the same manufacturer artwork in picker rows with an unknown fallback', () => {
    const view = renderPicker({ providers: undefined, models: [...models, { id: 'private', name: 'Private', provider: 'custom' }] });
    expect(view.getByTestId('model-picker-icon-openai:gpt-5-api').props.source).toBe(401);
    expect(view.getByTestId('model-picker-icon-anthropic:claude-sonnet').props.source).toBe(402);
    expect(view.getByTestId('model-picker-icon-custom:private').props.source).toBeUndefined();
    fireEvent.press(view.getByTestId('model-picker-row-anthropic:claude-sonnet'));
    expect(view.onSelectModel).toHaveBeenCalledWith(models[1]);
  });

  it('uses canonical fixed-detent Sheet chrome and keeps sheet-safe list behavior', () => {
    const view = renderPicker();
    const sheet = view.getByTestId('model-picker-shell');
    expect(sheet.props).toMatchObject({
      canonicalSheet: true,
      snapPoints: ['68%', '92%'],
      keyboardBehavior: 'extend',
      keyboardBlurBehavior: 'none',
      androidKeyboardInputMode: 'adjustResize',
    });

    const list = view.getByTestId('model-picker-section-list');
    expect(list.props).toMatchObject({
      stickySectionHeadersEnabled: true,
      keyboardDismissMode: 'on-drag',
      keyboardShouldPersistTaps: 'always',
      initialNumToRender: 18,
      maxToRenderPerBatch: 24,
      windowSize: 10,
      removeClippedSubviews: true,
      showsVerticalScrollIndicator: true,
    });
    expect(view.getByTestId('model-picker-search').props.compositionSafeBottomSheet).toBe(true);
  });

  it('renders provider sections and one recognizable model name without duplicate metadata', () => {
    const view = renderPicker();
    expect(view.getByText('OpenAI')).toBeTruthy();
    expect(view.getByText('Anthropic')).toBeTruthy();
    expect(view.getByText('GPT Five')).toBeTruthy();
    expect(view.queryByText('gpt-5-api')).toBeNull();
    expect(view.queryByText('Current')).toBeNull();
    expect(view.getByTestId('model-picker-row-openai:gpt-5-api').props.accessibilityState)
      .toEqual({ selected: true });
    expect(view.getByTestId('model-picker-selected-openai:gpt-5-api')).toBeTruthy();
  });

  it('selects a model with feedback and closes through the controlled Sheet boundary', () => {
    const view = renderPicker();
    fireEvent.press(view.getByTestId('model-picker-row-anthropic:claude-sonnet'));
    expect(triggerLightImpact).toHaveBeenCalledTimes(1);
    expect(view.onSelectModel).toHaveBeenCalledWith(models[1]);
    expect(view.onClose).toHaveBeenCalledTimes(1);
  });

  it('forwards the canonical Sheet close action once', () => {
    const view = renderPicker();
    fireEvent.press(view.getByTestId('model-picker-close'));
    expect(view.onClose).toHaveBeenCalledTimes(1);
    expect(view.onSelectModel).not.toHaveBeenCalled();
  });
});


it('shows the configured default independently of the selected checkmark and waits to navigate', () => {
  const onManage = jest.fn();
  const onClose = jest.fn();
  const view = render(<ModelPickerModal visible models={models} loading={false}
    defaultModel="claude-sonnet" defaultProvider="anthropic" configuredDefaultModel="openai/gpt-5-api"
    onSelectModel={jest.fn()} onClose={onClose} onManage={onManage} />);
  expect(view.getByTestId('model-picker-default-openai:gpt-5-api')).toBeTruthy();
  expect(view.getByTestId('model-picker-selected-anthropic:claude-sonnet')).toBeTruthy();
  expect(view.queryByTestId('model-picker-selected-openai:gpt-5-api')).toBeNull();
  fireEvent.press(view.getByTestId('model-picker-manage'));
  expect(onClose).toHaveBeenCalledTimes(1);
  expect(onManage).not.toHaveBeenCalled();
  view.getByTestId('model-picker-shell').props.onAfterClose();
  expect(onManage).toHaveBeenCalledTimes(1);
});

it('checks the inherited model without a duplicate Default row and restores inheritance on selection', () => {
  const view = renderPicker({ showDefault: true, selectedModelId: '', configuredDefaultModel: 'openai/gpt-5-api' });
  expect(view.queryByTestId('model-picker-row-default')).toBeNull();
  expect(view.getByTestId('model-picker-selected-openai:gpt-5-api')).toBeTruthy();
  expect(view.onSelectModel).not.toHaveBeenCalled();
  fireEvent.changeText(view.getByTestId('model-picker-search'), 'Claude');
  expect(view.queryByTestId('model-picker-row-default')).toBeNull();
  fireEvent.changeText(view.getByTestId('model-picker-search'), '');
  fireEvent.press(view.getByTestId('model-picker-row-openai:gpt-5-api'));
  expect(view.onSelectModel).toHaveBeenCalledWith({ id: '', name: 'Default', provider: '' });
});

it('keeps explicit overrides checked and lets them return to the inherited model', () => {
  const view = renderPicker({ showDefault: true, selectedModelId: 'anthropic/claude-sonnet', configuredDefaultModel: 'openai/gpt-5-api' });
  expect(view.getByTestId('model-picker-selected-anthropic:claude-sonnet')).toBeTruthy();
  expect(view.queryByTestId('model-picker-selected-openai:gpt-5-api')).toBeNull();
  fireEvent.press(view.getByTestId('model-picker-row-openai:gpt-5-api'));
  expect(view.onSelectModel).toHaveBeenCalledWith({ id: '', name: 'Default', provider: '' });
});

it.each([undefined, 'missing/model'])('retains the inheritance action when the default cannot be resolved: %s', configuredDefaultModel => {
  const view = renderPicker({ showDefault: true, selectedModelId: '', configuredDefaultModel });
  expect(view.getByTestId('model-picker-selected-default')).toBeTruthy();
  fireEvent.press(view.getByTestId('model-picker-row-default'));
  expect(view.onSelectModel).toHaveBeenCalledWith({ id: '', name: 'Default', provider: '' });
});

it('keeps concrete selection semantics for callers without inheritance', () => {
  const view = renderPicker({ configuredDefaultModel: 'openai/gpt-5-api' });
  fireEvent.press(view.getByTestId('model-picker-row-openai:gpt-5-api'));
  expect(view.onSelectModel).toHaveBeenCalledWith(models[0]);
});

it('shows native resolved model IDs below aliases and still submits the original alias', () => {
  const model = { id: 'haiku', name: 'Haiku', provider: 'anthropic', resolvedModel: 'claude-haiku-4-5-20251001' };
  const selected = jest.fn();
  const view = renderPicker({ models: [model], onSelectModel: selected });
  expect(view.getByTestId('model-picker-resolved-anthropic:haiku').props.children).toBe(model.resolvedModel);
  fireEvent.press(view.getByTestId('model-picker-row-anthropic:haiku'));
  expect(selected).toHaveBeenCalledWith(model);
});
