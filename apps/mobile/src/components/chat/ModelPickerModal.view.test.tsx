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
    ActivityIndicator: primitive('ActivityIndicator'),
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

  it('uses canonical fixed-detent Sheet chrome and keeps sheet-safe list behavior', () => {
    const view = renderPicker();
    const sheet = view.getByTestId('model-picker-shell');
    expect(sheet.props).toMatchObject({
      canonicalSheet: true,
      snapPoints: ['58%', '92%'],
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
