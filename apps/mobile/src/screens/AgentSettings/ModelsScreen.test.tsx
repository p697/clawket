import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CAPABILITY_MATRIX, type AgentAdapter, type AgentDescriptor, type ModelCatalogState, type ModelSelectionState } from '@clawket/agent-protocol';
import { ModelsScreen } from './ModelsScreen';

const mockPreventRemove = jest.fn();
const mockAnalytics = {
  modelsSaveTapped: jest.fn(),
  modelAddTapped: jest.fn(),
  modelDeleteTapped: jest.fn(),
  modelCostSaveTapped: jest.fn(),
  modelAllowlistToggled: jest.fn(),
};
jest.mock('@react-navigation/native', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }));
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(({ children, style, ...props }: Record<string, unknown>, ref: unknown) =>
    ReactRuntime.createElement(name, { ...props, ref, style: typeof style === 'function' ? style({ pressed: false }) : style }, children));
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: host('Pressable'), View: host('View'), Text: host('Text'), TextInput: host('TextInput'), ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'),
    Switch: host('Switch'),
    Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? children : null,
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1 },
  };
});
jest.mock('lucide-react-native', () => new Proxy({}, {
  get: (_target, key) => key === '__esModule' ? true : (props: unknown) => require('react').createElement('Icon', props),
}));
jest.mock('react-i18next', () => ({ useTranslation: () => ({
  t: (key: string, values?: Record<string, unknown>) => key.replace(/{{(.*?)}}/g, (_, name) => String(values?.[name] ?? name)),
  i18n: { resolvedLanguage: 'en' },
}) }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 44, bottom: 34, left: 0, right: 0 }) }));
jest.mock('expo-clipboard', () => ({ setStringAsync: jest.fn(async () => undefined) }));
jest.mock('../../services/analytics/events', () => ({
  analyticsEvents: new Proxy({}, { get: (_target, key: string) => (mockAnalytics as Record<string, jest.Mock>)[key] }),
}));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: require('../../theme/theme').buildInterfaceTheme('light', 'light', require('../../theme/accents').builtInAccents.iceBlue) }) }));
jest.mock('../../components/ui/ScreenHeader', () => ({ ScreenHeader: ({ title, onBack, rightContent }: Record<string, unknown>) => {
  const R = require('react');
  return R.createElement('View', null, R.createElement('Text', { testID: 'models-title' }, title), R.createElement('Pressable', { testID: 'models-back', onPress: onBack }), rightContent);
} }));
jest.mock('../../components/ui/Banner', () => ({ Banner: ({ testID, message, onAction }: Record<string, any>) => {
  const R = require('react');
  return R.createElement('View', { testID, onAction }, R.createElement('Text', null, message));
} }));
jest.mock('../../components/ui/FormTextInput', () => ({ FormTextInput: (props: unknown) => require('react').createElement('TextInput', props) }));
jest.mock('../../components/ui/SearchInput', () => ({ SearchInput: (props: Record<string, unknown>) => require('react').createElement('TextInput', props) }));
jest.mock('../../components/ui/FloatingButton', () => ({ FloatingButton: (props: unknown) => require('react').createElement('Pressable', props) }));
jest.mock('../../components/ui/Skeleton', () => ({ Skeleton: (props: unknown) => require('react').createElement('View', props) }));
jest.mock('../../components/ui/ThemedSwitch', () => ({ ThemedSwitch: (props: unknown) => require('react').createElement('Switch', props) }));
jest.mock('../../components/ui/Sheet', () => ({ Sheet: ({ visible, children, footer, ...props }: Record<string, unknown>) => visible
  ? require('react').createElement('View', props, children, footer)
  : null }));
jest.mock('../../components/ui/ConfirmationModal', () => ({ ConfirmationModal: ({ visible, testID, onConfirm, onClose }: Record<string, unknown>) => {
  const R = require('react');
  return visible ? R.createElement('View', { testID },
    R.createElement('Pressable', { testID: `${testID}-confirm`, onPress: onConfirm }),
    R.createElement('Pressable', { testID: `${testID}-cancel`, onPress: onClose })) : null;
} }));
jest.mock('../../components/chat/ModelPickerModal', () => ({ ModelPickerModal: ({ visible, models, onSelectModel, onClose }: Record<string, any>) => {
  const R = require('react');
  return visible ? R.createElement('View', { testID: 'models-picker' },
    models.map((model: { id: string; provider: string }) => R.createElement('Pressable', {
      key: `${model.provider}:${model.id}`, testID: `models-picker-${model.provider}:${model.id}`, onPress: () => { onSelectModel(model); onClose(); },
    }))) : null;
} }));
jest.mock('../../components/chat/ThinkingLevelPickerModal', () => ({ ThinkingLevelPickerModal: ({ visible, options, onSelect }: Record<string, any>) => {
  const R = require('react');
  return visible ? R.createElement('View', { testID: 'models-thinking-picker' },
    options.map((level: string) => R.createElement('Pressable', { key: level, testID: `models-thinking-${level}`, onPress: () => onSelect(level) }))) : null;
} }));

const agent: AgentDescriptor = { connectionId: 'studio', agentId: 'main', name: 'Main', isMain: true, mainSessionKey: 'agent:main:main' };

const catalog: ModelCatalogState = {
  defaults: { primary: 'openai/gpt-5', fallbacks: [], thinkingDefault: '' },
  allowlist: null,
  providers: [
    {
      slug: 'openai',
      explicit: true,
      baseUrl: 'https://api.openai.com/v1',
      models: [
        { id: 'gpt-5', name: 'GPT-5', provider: 'openai', contextWindow: 200_000, configured: true, costOverridden: false },
        { id: 'mini', name: 'Mini', provider: 'openai', configured: false, costOverridden: false },
      ],
    },
  ],
};

const selection: ModelSelectionState = {
  currentModel: 'flash',
  currentProvider: 'google',
  currentBaseUrl: '',
  models: [
    { id: 'flash', name: 'Flash', provider: 'google' },
    { id: 'pro', name: 'Pro', provider: 'google' },
  ],
};

function openClawAdapter(overrides: Record<string, jest.Mock> = {}) {
  const models = {
    getCatalog: jest.fn(async () => catalog),
    saveCatalog: jest.fn(async () => undefined),
    addModel: jest.fn(async () => undefined),
    inspectDeletion: jest.fn(async () => ({ canDelete: true, blocks: [], cleanupCount: 1 })),
    deleteModel: jest.fn(async () => undefined),
    setCost: jest.fn(async () => undefined),
    listThinkingLevels: jest.fn(() => ['off', 'low', 'high']),
    ...overrides,
  };
  return {
    models,
    adapter: { capabilities: CAPABILITY_MATRIX.openclaw, management: { models } } as unknown as AgentAdapter,
  };
}

function hermesAdapter() {
  const models = {
    getSelection: jest.fn(async () => selection),
    setSelection: jest.fn(async () => ({ ...selection, currentModel: 'pro', ok: true, scope: 'global' as const })),
    listThinkingLevels: jest.fn(() => ['off', 'low']),
  };
  return {
    models,
    adapter: { capabilities: CAPABILITY_MATRIX.hermes, management: { models } } as unknown as AgentAdapter,
  };
}

const navigation = { goBack: jest.fn(), dispatch: jest.fn() };

describe('ModelsScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('edits OpenClaw defaults and the allowlist as one draft and saves once after confirmation', async () => {
    const { adapter, models } = openClawAdapter();
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} />);
    await waitFor(() => expect(view.getByTestId('agent-model-row-openai:mini')).toBeTruthy());
    expect(view.getByTestId('agent-models-save').props.disabled).toBe(true);

    fireEvent(view.getByTestId('agent-model-enabled-openai:mini'), 'valueChange', false);
    expect(mockAnalytics.modelAllowlistToggled).toHaveBeenCalledWith({ provider: 'openai', enabled: false, source: 'models_list' });
    fireEvent.press(view.getByTestId('agent-models-thinking'));
    fireEvent.press(view.getByTestId('models-thinking-high'));
    fireEvent.press(view.getByTestId('agent-models-default'));
    fireEvent.press(view.getByTestId('models-picker-openai:mini'));
    expect(view.getByTestId('agent-models-save').props.disabled).toBe(false);
    expect(mockPreventRemove).toHaveBeenLastCalledWith(true, expect.any(Function));

    fireEvent.press(view.getByTestId('agent-models-save'));
    fireEvent.press(view.getByTestId('agent-models-confirm-confirm'));
    await waitFor(() => expect(models.saveCatalog).toHaveBeenCalledWith({
      defaults: { primary: 'openai/mini', fallbacks: [], thinkingDefault: 'high' },
      allowlist: [
        { provider: 'openai', modelId: 'gpt-5', enabled: true },
        { provider: 'openai', modelId: 'mini', enabled: false },
      ],
    }));
    expect(mockAnalytics.modelsSaveTapped).toHaveBeenCalledWith({ fallback_count: 0, has_primary_model: true, has_thinking_default: true });
    await waitFor(() => expect(view.getByTestId('agent-models-save').props.disabled).toBe(true));
  });

  it('leads the catalog with the default model provider, labels that row and shows no row subtitles', async () => {
    const getCatalog = jest.fn(async () => ({
      ...catalog,
      providers: [
        { slug: 'anthropic', explicit: true, models: [{ id: 'sonnet', name: 'Sonnet', provider: 'anthropic', reasoning: true, configured: true, costOverridden: false }] },
        ...catalog.providers,
      ],
    }));
    const { adapter } = openClawAdapter({ getCatalog });
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} isPro />);
    await waitFor(() => expect(view.getByTestId('agent-model-row-anthropic:sonnet')).toBeTruthy());
    const providers = view.getAllByTestId(/^agent-models-provider-/).map((node) => node.props.testID);
    expect(providers).toEqual(['agent-models-provider-openai', 'agent-models-provider-anthropic']);
    expect(view.getByTestId('agent-model-default-openai:gpt-5')).toBeTruthy();
    expect(view.getByTestId('agent-model-enabled-openai:gpt-5').props.disabled).toBe(true);
    expect(view.queryByTestId('agent-model-default-openai:mini')).toBeNull();
    expect(view.queryByText('Reasoning')).toBeNull();
    expect(view.queryByText('200K')).toBeNull();
    expect(view.getByTestId('agent-models-fallbacks').props.accessibilityLabel).toBe('Fallback models, None');
  });

  it('asks before discarding a dirty draft on back', async () => {
    const { adapter } = openClawAdapter();
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} />);
    await waitFor(() => expect(view.getByTestId('agent-model-row-openai:mini')).toBeTruthy());
    fireEvent.press(view.getByTestId('models-back'));
    expect(navigation.goBack).toHaveBeenCalledTimes(1);
    fireEvent(view.getByTestId('agent-model-enabled-openai:mini'), 'valueChange', false);
    fireEvent.press(view.getByTestId('models-back'));
    expect(view.getByTestId('agent-models-discard')).toBeTruthy();
    fireEvent.press(view.getByTestId('agent-models-discard-confirm'));
    await waitFor(() => expect(navigation.goBack).toHaveBeenCalledTimes(2));
  });

  it('adds a model from the provider sheet and deletes one from the detail sheet with confirmation', async () => {
    const { adapter, models } = openClawAdapter();
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} onOpenProviderConfig={jest.fn()} />);
    await waitFor(() => expect(view.getByTestId('agent-models-provider-openai')).toBeTruthy());

    fireEvent.press(view.getByTestId('agent-models-provider-openai'));
    fireEvent.press(view.getByTestId('agent-model-add-submit'));
    expect(view.getByTestId('agent-model-provider-validation')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('agent-model-add-id'), 'gpt-6');
    fireEvent.press(view.getByTestId('agent-model-add-submit'));
    fireEvent.press(view.getByTestId('agent-models-confirm-confirm'));
    await waitFor(() => expect(models.addModel).toHaveBeenCalledWith({ provider: 'openai', modelId: 'gpt-6', modelName: 'gpt-6' }));
    expect(mockAnalytics.modelAddTapped).toHaveBeenCalledWith({ provider: 'openai', has_custom_name: false, source: 'provider_sheet' });
    await waitFor(() => expect(models.getCatalog).toHaveBeenCalledTimes(2));

    fireEvent.press(view.getByTestId('agent-model-row-openai:mini'));
    await waitFor(() => expect(models.inspectDeletion).toHaveBeenCalledWith({ provider: 'openai', modelId: 'mini' }));
    await waitFor(() => expect(view.getByTestId('agent-model-delete').props.disabled).toBe(false));
    fireEvent.press(view.getByTestId('agent-model-delete'));
    fireEvent.press(view.getByTestId('agent-models-confirm-confirm'));
    await waitFor(() => expect(models.deleteModel).toHaveBeenCalledWith({ provider: 'openai', modelId: 'mini' }));
    expect(mockAnalytics.modelDeleteTapped).toHaveBeenCalledWith({ provider: 'openai', blocked_reference_count: 0, source: 'model_sheet' });
  });

  it('blocks deletion and immediate writes while a draft is unsaved', async () => {
    const inspectDeletion = jest.fn(async () => ({
      canDelete: false, blocks: [{ path: 'agents.defaults.model', reason: 'defaults_primary' }], cleanupCount: 0,
    }));
    const { adapter, models } = openClawAdapter({ inspectDeletion });
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} />);
    await waitFor(() => expect(view.getByTestId('agent-model-row-openai:gpt-5')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-model-row-openai:gpt-5'));
    await waitFor(() => expect(view.getByText('Still used by Agent defaults')).toBeTruthy());
    expect(view.getByTestId('agent-model-delete').props.disabled).toBe(true);
    expect(models.deleteModel).not.toHaveBeenCalled();
  });

  it('explains a catalog-only model plainly instead of naming it as a reference', async () => {
    const inspectDeletion = jest.fn(async () => ({
      canDelete: false, blocks: [{ path: 'models.providers', reason: 'model_not_configured' }], cleanupCount: 0,
    }));
    const { adapter } = openClawAdapter({ inspectDeletion });
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} />);
    await waitFor(() => expect(view.getByTestId('agent-model-row-openai:gpt-5')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-model-row-openai:gpt-5'));
    await waitFor(() => expect(view.getByText('Not in Gateway config')).toBeTruthy());
    expect(view.queryByText(/Still used by/)).toBeNull();
    expect(view.getByTestId('agent-model-delete').props.disabled).toBe(true);
  });

  it('saves a cost override through the detail sheet', async () => {
    const { adapter, models } = openClawAdapter();
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} />);
    await waitFor(() => expect(view.getByTestId('agent-model-row-openai:gpt-5')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-model-row-openai:gpt-5'));
    fireEvent.press(view.getByTestId('agent-model-edit-cost'));
    fireEvent.changeText(view.getByTestId('agent-model-cost-input'), 'abc');
    fireEvent.press(view.getByTestId('agent-model-cost-save'));
    expect(view.getByTestId('agent-model-cost-error')).toBeTruthy();
    fireEvent.changeText(view.getByTestId('agent-model-cost-input'), '1.5');
    fireEvent.changeText(view.getByTestId('agent-model-cost-output'), '3');
    fireEvent.press(view.getByTestId('agent-model-cost-save'));
    fireEvent.press(view.getByTestId('agent-models-confirm-confirm'));
    await waitFor(() => expect(models.setCost).toHaveBeenCalledWith({
      provider: 'openai', modelId: 'gpt-5', modelName: 'GPT-5', cost: { input: 1.5, output: 3, cacheRead: 0, cacheWrite: 0 },
    }));
    expect(mockAnalytics.modelCostSaveTapped).toHaveBeenCalledWith({
      provider: 'openai', has_existing_override: false, changed_field_count: 2, source: 'model_sheet',
    });
  });

  it('shows the global current model for Hermes and switches it through the detail sheet', async () => {
    const { adapter, models } = hermesAdapter();
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} />);
    await waitFor(() => expect(view.getByTestId('agent-models-current')).toBeTruthy());
    expect(view.queryByTestId('agent-models-save')).toBeNull();
    expect(view.queryByTestId('agent-model-enabled-google:pro')).toBeNull();
    expect(view.getByTestId('agent-model-current-google:flash')).toBeTruthy();

    fireEvent.press(view.getByTestId('agent-model-row-google:pro'));
    expect(view.queryByTestId('agent-model-delete')).toBeNull();
    expect(view.queryByTestId('agent-model-toggle-fallback')).toBeNull();
    fireEvent.press(view.getByTestId('agent-model-set-default'));
    await waitFor(() => expect(models.setSelection).toHaveBeenCalledWith({ model: 'pro', provider: 'google', scope: 'global', sessionKey: null }));
    await waitFor(() => expect(view.getByTestId('agent-model-current-google:pro')).toBeTruthy());
    expect(mockPreventRemove).toHaveBeenLastCalledWith(false, expect.any(Function));
  });

  it('opens the paywall on every write for free users and resumes the write after purchase', async () => {
    const { adapter, models } = openClawAdapter();
    const onOpenPaywall = jest.fn();
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} isPro={false} onOpenPaywall={onOpenPaywall} />);
    await waitFor(() => expect(view.getByTestId('agent-model-row-openai:mini')).toBeTruthy());

    fireEvent(view.getByTestId('agent-model-enabled-openai:mini'), 'valueChange', false);
    expect(onOpenPaywall).toHaveBeenCalledWith('modelManage', expect.any(Function));
    expect(view.getByTestId('agent-model-enabled-openai:mini').props.value).toBe(true);
    expect(view.getByTestId('agent-models-save').props.disabled).toBe(true);
    expect(mockAnalytics.modelAllowlistToggled).not.toHaveBeenCalled();

    fireEvent.press(view.getByTestId('agent-models-default'));
    fireEvent.press(view.getByTestId('models-picker-openai:gpt-5'));
    expect(onOpenPaywall).toHaveBeenCalledTimes(1);
    fireEvent.press(view.getByTestId('agent-models-default'));
    fireEvent.press(view.getByTestId('models-picker-openai:mini'));
    expect(onOpenPaywall).toHaveBeenCalledTimes(2);
    expect(view.getByTestId('agent-models-save').props.disabled).toBe(true);

    fireEvent.press(view.getByTestId('agent-model-row-openai:mini'));
    await waitFor(() => expect(view.getByTestId('agent-model-delete').props.disabled).toBe(false));
    fireEvent.press(view.getByTestId('agent-model-delete'));
    expect(onOpenPaywall).toHaveBeenCalledTimes(3);
    expect(view.queryByTestId('agent-models-confirm')).toBeNull();

    act(() => { onOpenPaywall.mock.calls[1]![1](); });
    await waitFor(() => expect(view.getByTestId('agent-models-save').props.disabled).toBe(false));
    fireEvent.press(view.getByTestId('agent-models-save'));
    fireEvent.press(view.getByTestId('agent-models-confirm-confirm'));
    await waitFor(() => expect(models.saveCatalog).toHaveBeenCalledWith({
      defaults: { primary: 'openai/mini', fallbacks: [], thinkingDefault: '' },
    }));
  });

  it('keeps the Hermes current-model switch free', async () => {
    const { adapter, models } = hermesAdapter();
    const onOpenPaywall = jest.fn();
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} onOpenPaywall={onOpenPaywall} />);
    await waitFor(() => expect(view.getByTestId('agent-model-row-google:pro')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-models-current'));
    fireEvent.press(view.getByTestId('models-picker-google:flash'));
    expect(onOpenPaywall).not.toHaveBeenCalled();
    fireEvent.press(view.getByTestId('agent-models-current'));
    fireEvent.press(view.getByTestId('models-picker-google:pro'));
    expect(onOpenPaywall).not.toHaveBeenCalled();
    await waitFor(() => expect(models.setSelection).toHaveBeenCalledWith({ model: 'pro', provider: 'google', scope: 'global', sessionKey: null }));
  });

  it('adds a model from the visible catalog action after choosing a provider', async () => {
    const { adapter, models } = openClawAdapter();
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} isPro />);
    await waitFor(() => expect(view.getByTestId('agent-models-add')).toBeTruthy());
    fireEvent.press(view.getByTestId('agent-models-add'));
    expect(view.queryByTestId('agent-model-add-id')).toBeNull();
    fireEvent.press(view.getByTestId('agent-model-add-provider-openai'));
    fireEvent.changeText(view.getByTestId('agent-model-add-id'), 'new-model');
    fireEvent.press(view.getByTestId('agent-model-add-submit'));
    fireEvent.press(view.getByTestId('agent-models-confirm-confirm'));
    await waitFor(() => expect(models.addModel).toHaveBeenCalledWith({ provider: 'openai', modelId: 'new-model', modelName: 'new-model' }));
  });

  it('ignores a purchase continuation after the page goes offline', async () => {
    const { adapter } = openClawAdapter();
    const onOpenPaywall = jest.fn();
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online navigation={navigation} onOpenPaywall={onOpenPaywall} />);
    await waitFor(() => expect(view.getByTestId('agent-model-enabled-openai:mini')).toBeTruthy());
    fireEvent(view.getByTestId('agent-model-enabled-openai:mini'), 'valueChange', false);
    view.rerender(<ModelsScreen adapter={adapter} agent={agent} online={false} navigation={navigation} onOpenPaywall={onOpenPaywall} />);
    act(() => onOpenPaywall.mock.calls[0][1]());
    expect(view.getByTestId('agent-model-enabled-openai:mini').props.value).toBe(true);
  });

  it('surfaces load failures with retry and keeps writes disabled offline', async () => {
    const getCatalog = jest.fn().mockRejectedValueOnce(new Error('Gateway down')).mockResolvedValue(catalog);
    const { adapter } = openClawAdapter({ getCatalog });
    const view = render(<ModelsScreen adapter={adapter} agent={agent} online={false} navigation={navigation} />);
    await waitFor(() => expect(view.getByTestId('agent-models-load-error')).toBeTruthy());
    await act(async () => { view.getByTestId('agent-models-load-error').props.onAction(); });
    await waitFor(() => expect(view.getByTestId('agent-model-row-openai:mini')).toBeTruthy());
    expect(view.getByTestId('agent-model-enabled-openai:mini').props.disabled).toBe(true);
    expect(view.getByTestId('agent-models-save').props.disabled).toBe(true);
  });
});
