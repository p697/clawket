import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DocumentScreen } from './DocumentScreen';
import type { DocumentContent, DocumentSource } from './document-model';

const mockPreventRemove = jest.fn();
jest.mock('@react-navigation/native', () => ({ usePreventRemove: (...args: unknown[]) => mockPreventRemove(...args) }));
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ReactRuntime.forwardRef(({ children, style, ...props }: Record<string, unknown>, ref: unknown) =>
    ReactRuntime.createElement(name, { ...props, ref, style: typeof style === 'function' ? style({ pressed: false }) : style }, children));
  return {
    Platform: { OS: 'ios', select: (options: Record<string, unknown>) => options.ios ?? options.default },
    Pressable: host('Pressable'), View: host('View'), Text: host('Text'), TextInput: host('TextInput'), ScrollView: host('ScrollView'), ActivityIndicator: host('ActivityIndicator'),
    Modal: ({ visible, children }: { visible: boolean; children: React.ReactNode }) => visible ? children : null,
    StyleSheet: { create: <T,>(styles: T) => styles, flatten: (style: unknown) => style, hairlineWidth: 1, absoluteFill: {} },
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
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: require('../../theme/theme').buildInterfaceTheme('light', 'light', require('../../theme/accents').builtInAccents.iceBlue) }) }));
jest.mock('react-native-enriched-markdown', () => ({
  EnrichedMarkdownText: (props: Record<string, unknown>) => require('react').createElement('Markdown', props),
}));
jest.mock('../../components/ui/ScreenHeader', () => ({ ScreenHeader: ({ title, subtitle, status, onBack, leftContent, rightContent }: Record<string, unknown>) => {
  const R = require('react');
  return R.createElement('View', null,
    R.createElement('Text', { testID: 'document-title' }, title),
    subtitle ? R.createElement('Text', { testID: 'document-subtitle' }, subtitle) : null,
    status ?? null,
    leftContent ?? R.createElement('Pressable', { testID: 'document-back', onPress: onBack }),
    rightContent ?? null,
  );
} }));
jest.mock('../../components/ui/ConnectionStatusPill', () => ({ ConnectionStatusPill: (props: unknown) => require('react').createElement('StatusPill', props) }));
jest.mock('../../components/ui/CompositionSafeTextInput', () => ({ CompositionSafeTextInput: (props: unknown) => require('react').createElement('TextInput', props) }));
jest.mock('../../components/ui/Skeleton', () => ({ Skeleton: (props: unknown) => require('react').createElement('View', props) }));

const navigation = () => ({ goBack: jest.fn(), dispatch: jest.fn() } as unknown as React.ComponentProps<typeof DocumentScreen>['navigation']);

function sourceWith(input: Readonly<{
  content?: Partial<DocumentContent>;
  load?: jest.Mock;
  save?: jest.Mock | null;
  key?: string;
}> = {}) {
  const load = input.load ?? jest.fn(async (): Promise<DocumentContent> => ({ content: '# Title\n\nBody', editable: true, size: 13, updatedAtMs: 1_700_000_000_000, ...input.content }));
  const save = input.save === null ? undefined : input.save ?? jest.fn(async () => ({ ok: true }));
  const onActivity = jest.fn();
  const source: DocumentSource = { key: input.key ?? 'doc', load, ...(save ? { save } : {}), onActivity };
  return { source, load, save, onActivity };
}

function renderPage(data: ReturnType<typeof sourceWith>, patch: Partial<React.ComponentProps<typeof DocumentScreen>> = {}) {
  const nav = navigation();
  const onOpenPaywall = jest.fn();
  const props: React.ComponentProps<typeof DocumentScreen> = {
    title: 'MEMORY.md', source: data.source, online: true, isPro: true, navigation: nav, onOpenPaywall, ...patch,
  };
  const view = render(<DocumentScreen {...props} />);
  return { view, nav, onOpenPaywall, props };
}

describe('DocumentScreen', () => {
  it('opens linked source files and displays script text without a writable editor', async () => {
    const open = jest.fn();
    const data = sourceWith({ content: { linkedFiles: ['scripts/run.py'], editable: false, plainText: true, content: 'print(1)' }, save: null });
    const { view } = renderPage(data, { onOpenLinkedFile: open });
    await waitFor(() => expect(view.getByTestId('document-linked-scripts/run.py')).toBeTruthy());
    expect(view.getByText('print(1)')).toBeTruthy();
    fireEvent.press(view.getByTestId('document-linked-scripts/run.py'));
    expect(open).toHaveBeenCalledWith('scripts/run.py');
    expect(view.queryByTestId('document-edit')).toBeNull();
  });

  beforeEach(() => mockPreventRemove.mockClear());

  it('reads the whole document as Markdown with its size and date, then edits, saves and returns to reading', async () => {
    const data = sourceWith();
    const onSaved = jest.fn();
    const { view, onOpenPaywall } = renderPage(data, { onSaved });
    expect(view.getByTestId('document-loading')).toBeTruthy();
    await waitFor(() => expect(view.getByTestId('document-content')).toBeTruthy());
    expect(view.UNSAFE_getByType('Markdown' as never).props.markdown).toBe('# Title\n\nBody');
    expect(view.getByTestId('document-meta').props.children).toMatch(/^13 B · /);
    expect(view.getByTestId('document-back')).toBeTruthy();

    fireEvent.press(view.getByTestId('document-edit'));
    expect(data.onActivity).toHaveBeenLastCalledWith('edit');
    expect(view.getByTestId('document-input').props.value).toBe('# Title\n\nBody');
    // An existing document does not steal focus: the reader taps where they want to edit.
    expect(view.getByTestId('document-input').props.autoFocus).toBe(false);
    expect(view.queryByTestId('document-back')).toBeNull();
    expect(view.getByTestId('document-save').props.disabled).toBe(true);
    fireEvent.changeText(view.getByTestId('document-input'), '# Title\n\nChanged');
    expect(view.getByTestId('document-save').props.disabled).toBe(false);
    fireEvent.press(view.getByTestId('document-save'));
    expect(onOpenPaywall).not.toHaveBeenCalled();
    await waitFor(() => expect(data.save).toHaveBeenCalledWith('# Title\n\nChanged'));
    await waitFor(() => expect(view.getByTestId('document-content')).toBeTruthy());
    expect(view.UNSAFE_getByType('Markdown' as never).props.markdown).toBe('# Title\n\nChanged');
    expect(view.getByTestId('document-meta').props.children).toMatch(/^16 B · /);
    expect(data.onActivity).toHaveBeenLastCalledWith('saved');
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(data.load).toHaveBeenCalledTimes(1);
  });

  it('routes a free save through the paywall and only resumes the draft that was gated', async () => {
    const data = sourceWith();
    const { view, onOpenPaywall } = renderPage(data, { isPro: false });
    await waitFor(() => expect(view.getByTestId('document-edit')).toBeTruthy());
    fireEvent.press(view.getByTestId('document-edit'));
    fireEvent.changeText(view.getByTestId('document-input'), 'First');
    fireEvent.press(view.getByTestId('document-save'));
    expect(onOpenPaywall).toHaveBeenCalledWith('coreFileEditing', expect.any(Function));
    expect(data.save).not.toHaveBeenCalled();
    const first = onOpenPaywall.mock.calls[0][1] as () => void;
    fireEvent.changeText(view.getByTestId('document-input'), 'Second');
    await act(async () => first());
    expect(data.save).not.toHaveBeenCalled();
    expect(view.getByTestId('document-input').props.value).toBe('Second');

    fireEvent.press(view.getByTestId('document-save'));
    const second = onOpenPaywall.mock.calls[1][1] as () => void;
    act(() => { second(); second(); });
    await waitFor(() => expect(data.save).toHaveBeenCalledTimes(1));
    expect(data.save).toHaveBeenCalledWith('Second');
  });

  it.each(['unmount', 'offline'] as const)('drops a gated save after %s', async (change) => {
    const data = sourceWith();
    const { view, onOpenPaywall, props } = renderPage(data, { isPro: false });
    await waitFor(() => expect(view.getByTestId('document-edit')).toBeTruthy());
    fireEvent.press(view.getByTestId('document-edit'));
    fireEvent.changeText(view.getByTestId('document-input'), 'Draft');
    fireEvent.press(view.getByTestId('document-save'));
    const resume = onOpenPaywall.mock.calls[0][1] as () => void;
    if (change === 'unmount') view.unmount();
    else view.rerender(<DocumentScreen {...props} online={false} />);
    await act(async () => resume());
    expect(data.save).not.toHaveBeenCalled();
  });

  it('keeps a rejected draft with the error in place and retries in the same editor', async () => {
    const save = jest.fn().mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValueOnce({ ok: false }).mockResolvedValue({ ok: true });
    const data = sourceWith({ save });
    const { view } = renderPage(data);
    await waitFor(() => expect(view.getByTestId('document-edit')).toBeTruthy());
    fireEvent.press(view.getByTestId('document-edit'));
    fireEvent.changeText(view.getByTestId('document-input'), 'Keep this draft');
    fireEvent.press(view.getByTestId('document-save'));
    await waitFor(() => expect(view.getByText('Temporary failure')).toBeTruthy());
    expect(view.getByTestId('document-input').props.value).toBe('Keep this draft');
    expect(data.onActivity).toHaveBeenLastCalledWith('failed');
    fireEvent.press(view.getByTestId('document-save'));
    await waitFor(() => expect(view.getByText('Save failed')).toBeTruthy());
    fireEvent.press(view.getByTestId('document-save'));
    await waitFor(() => expect(view.getByTestId('document-content')).toBeTruthy());
    expect(save).toHaveBeenCalledTimes(3);
  });

  it('confirms a dirty Cancel and returns to reading; a clean Cancel returns at once', async () => {
    const data = sourceWith();
    const { view, nav } = renderPage(data);
    await waitFor(() => expect(view.getByTestId('document-edit')).toBeTruthy());
    fireEvent.press(view.getByTestId('document-edit'));
    fireEvent.press(view.getByTestId('document-cancel'));
    expect(view.getByTestId('document-content')).toBeTruthy();

    fireEvent.press(view.getByTestId('document-edit'));
    fireEvent.changeText(view.getByTestId('document-input'), 'Draft');
    fireEvent.press(view.getByTestId('document-cancel'));
    expect(view.getByTestId('document-discard')).toBeTruthy();
    fireEvent.press(view.getByTestId('document-discard-cancel'));
    expect(view.getByTestId('document-input').props.value).toBe('Draft');
    fireEvent.press(view.getByTestId('document-cancel'));
    fireEvent.press(view.getByTestId('document-discard-confirm'));
    expect(view.getByTestId('document-content')).toBeTruthy();
    expect(view.UNSAFE_getByType('Markdown' as never).props.markdown).toBe('# Title\n\nBody');
    expect(nav.goBack).not.toHaveBeenCalled();
    expect(data.save).not.toHaveBeenCalled();
  });

  it('blocks route removal while a draft is dirty and leaves only after confirmation', async () => {
    const data = sourceWith();
    const { view, nav } = renderPage(data);
    await waitFor(() => expect(view.getByTestId('document-edit')).toBeTruthy());
    expect(mockPreventRemove.mock.calls.at(-1)?.[0]).toBe(false);
    fireEvent.press(view.getByTestId('document-edit'));
    fireEvent.changeText(view.getByTestId('document-input'), 'Draft');
    const [blocked, callback] = mockPreventRemove.mock.calls.at(-1)!;
    expect(blocked).toBe(true);
    act(() => callback({ data: { action: { type: 'POP' } } }));
    expect(view.getByTestId('document-discard')).toBeTruthy();
    fireEvent.press(view.getByTestId('document-discard-confirm'));
    await waitFor(() => expect(nav.dispatch).toHaveBeenCalledWith({ type: 'POP' }));
  });

  it('opens a missing file straight into a focused empty editor, creates it on save, and leaves on Cancel', async () => {
    const data = sourceWith({ content: { content: '', missing: true, size: undefined, updatedAtMs: undefined } });
    const first = renderPage(data);
    await waitFor(() => expect(first.view.getByTestId('document-input')).toBeTruthy());
    expect(first.view.getByTestId('document-input').props.autoFocus).toBe(true);
    expect(first.view.getByTestId('document-input').props.value).toBe('');
    expect(data.onActivity).toHaveBeenLastCalledWith('edit');
    fireEvent.press(first.view.getByTestId('document-cancel'));
    await waitFor(() => expect(first.nav.goBack).toHaveBeenCalledTimes(1));
    first.view.unmount();

    const second = renderPage(data);
    await waitFor(() => expect(second.view.getByTestId('document-input')).toBeTruthy());
    fireEvent.changeText(second.view.getByTestId('document-input'), '# Memory');
    fireEvent.press(second.view.getByTestId('document-save'));
    await waitFor(() => expect(data.save).toHaveBeenCalledWith('# Memory'));
    await waitFor(() => expect(second.view.getByTestId('document-content')).toBeTruthy());
    expect(second.view.getByTestId('document-meta').props.children).toMatch(/^8 B · /);
    // Cancel after creation stays on the page: there is now something to read.
    fireEvent.press(second.view.getByTestId('document-edit'));
    fireEvent.press(second.view.getByTestId('document-cancel'));
    expect(second.view.getByTestId('document-content')).toBeTruthy();
    expect(second.nav.goBack).not.toHaveBeenCalled();
  });

  it('shows read-only, empty, binary, unsupported and failed documents without an Edit action', async () => {
    const readOnly = renderPage(sourceWith({ content: { editable: false, size: undefined, updatedAtMs: undefined }, save: null }));
    await waitFor(() => expect(readOnly.view.getByTestId('document-content')).toBeTruthy());
    expect(readOnly.view.getByText('Read only')).toBeTruthy();
    expect(readOnly.view.queryByTestId('document-edit')).toBeNull();
    expect(readOnly.view.queryByTestId('document-meta')).toBeNull();
    readOnly.view.unmount();

    const empty = renderPage(sourceWith({ content: { content: '   ' } }));
    await waitFor(() => expect(empty.view.getByTestId('document-empty')).toBeTruthy());
    expect(empty.view.getByTestId('document-edit')).toBeTruthy();
    empty.view.unmount();

    const binary = renderPage(sourceWith({ content: { content: 'blob', editable: false, binary: true } }));
    await waitFor(() => expect(binary.view.getByText('Read only')).toBeTruthy());
    expect(binary.view.queryByTestId('document-content')).toBeNull();
    expect(binary.view.queryByTestId('document-empty')).toBeNull();
    binary.view.unmount();

    const unsupported = renderPage(sourceWith(), { source: null, title: 'SKILL.md', subtitle: 'Builder' });
    expect(unsupported.view.getByTestId('document-unsupported')).toBeTruthy();
    expect(unsupported.view.getByTestId('document-subtitle').props.children).toBe('Builder');
    expect(unsupported.view.queryByTestId('document-loading')).toBeNull();
    unsupported.view.unmount();

    const load = jest.fn().mockRejectedValueOnce(new Error('Gateway unavailable')).mockResolvedValue({ content: 'Recovered', editable: true, subtitle: 'Builder' });
    const failed = renderPage(sourceWith({ load }), { title: 'SKILL.md' });
    await waitFor(() => expect(failed.view.getByText('Gateway unavailable')).toBeTruthy());
    expect(failed.view.queryByTestId('document-edit')).toBeNull();
    fireEvent.press(failed.view.getByTestId('document-load-error-action'));
    await waitFor(() => expect(failed.view.getByTestId('document-content')).toBeTruthy());
    // A subtitle resolved by the read fills the header when the route carried none.
    expect(failed.view.getByTestId('document-subtitle').props.children).toBe('Builder');
  });

  it('disables editing offline, shows the connection state in the header and keeps the draft', async () => {
    const data = sourceWith();
    const { view, props } = renderPage(data);
    await waitFor(() => expect(view.getByTestId('document-edit')).toBeTruthy());
    fireEvent.press(view.getByTestId('document-edit'));
    fireEvent.changeText(view.getByTestId('document-input'), 'Draft');
    view.rerender(<DocumentScreen {...props} online={false} reconnecting />);
    expect(view.getByTestId('document-save').props.disabled).toBe(true);
    expect(view.getByTestId('document-input').props.value).toBe('Draft');
    expect(view.UNSAFE_getByType('StatusPill' as never).props.status).toBe('reconnecting');
    view.rerender(<DocumentScreen {...props} online={false} />);
    expect(view.getByTestId('document-offline').props.status).toBe('offline');
    view.rerender(<DocumentScreen {...props} />);
    expect(view.getByTestId('document-save').props.disabled).toBe(false);

    const offline = renderPage(sourceWith(), { online: false });
    await waitFor(() => expect(offline.view.getByTestId('document-edit')).toBeTruthy());
    expect(offline.view.getByTestId('document-edit').props.disabled).toBe(true);
  });

  it('starts over for a different document key and ignores the old draft', async () => {
    const first = sourceWith({ key: 'a' });
    const { view, props } = renderPage(first);
    await waitFor(() => expect(view.getByTestId('document-edit')).toBeTruthy());
    fireEvent.press(view.getByTestId('document-edit'));
    fireEvent.changeText(view.getByTestId('document-input'), 'Draft');
    const second = sourceWith({ key: 'b', content: { content: 'Other' } });
    view.rerender(<DocumentScreen {...props} source={second.source} title="SOUL.md" />);
    await waitFor(() => expect(view.getByTestId('document-content')).toBeTruthy());
    expect(view.UNSAFE_getByType('Markdown' as never).props.markdown).toBe('Other');
    expect(view.queryByTestId('document-input')).toBeNull();
    expect(second.load).toHaveBeenCalledTimes(1);
  });
});
