import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { ThreadAddSheet } from './ThreadAddSheet';

type MockRecentPhotos = {
  access: 'unavailable' | 'checking' | 'undetermined' | 'denied' | 'granted';
  photos: { id: string; uri: string; width: number; height: number }[];
  loading: boolean;
  request: jest.Mock;
};

const mockRequest = jest.fn();
let mockRecentPhotos: MockRecentPhotos;
let mockUseRecentPhotosArgs: { active: boolean } | null = null;

jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const host = (name: string) => ({ children, ...props }: Record<string, unknown>) => (
    ReactRuntime.createElement(name, props, children)
  );
  return {
    Image: host('Image'),
    Pressable: host('Pressable'),
    StyleSheet: {
      create: <T,>(styles: T) => styles,
      flatten: (style: unknown) => style,
      hairlineWidth: 1,
    },
    Text: host('Text'),
    View: host('View'),
    useWindowDimensions: () => ({ width: 390, height: 844, scale: 3, fontScale: 1 }),
  };
});

jest.mock('@gorhom/bottom-sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    BottomSheetScrollView: ({ children }: { children: React.ReactNode }) => ReactRuntime.createElement(View, null, children),
  };
});

jest.mock('react-native-gesture-handler', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    ScrollView: ({ children }: { children: React.ReactNode }) => ReactRuntime.createElement(View, null, children),
  };
});

jest.mock('lucide-react-native', () => {
  const ReactRuntime = require('react');
  return new Proxy({}, {
    get: (_target, property) => (props: Record<string, unknown>) => (
      ReactRuntime.createElement(String(property), props)
    ),
  });
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: Record<string, unknown>) => Object.entries(options ?? {}).reduce(
      (value, [name, replacement]) => value.replace(`{{${name}}}`, String(replacement)),
      key,
    ),
  }),
}));

jest.mock('../../../utils/platform', () => ({ isMacCatalyst: false }));
jest.mock('../../../services/recent-photos', () => ({ RECENT_PHOTO_STRIP_COUNT: 12 }));
jest.mock('../../../services/haptics', () => ({ triggerSelectionHaptic: jest.fn() }));

jest.mock('../../../theme', () => ({
  useAppTheme: () => ({
    theme: {
      colors: {
        accent: '#1f5eff',
        onAccent: '#ffffff',
        canvas: '#ffffff',
        surface: '#f4f4f5',
        surfaceFloating: '#ffffff',
        ink: '#111113',
        inkSecondary: '#6b6b72',
      },
    },
  }),
}));

jest.mock('../../../hooks/useRecentPhotos', () => ({
  useRecentPhotos: (args: { active: boolean }) => {
    mockUseRecentPhotosArgs = args;
    return { ...mockRecentPhotos, request: mockRequest };
  },
}));

jest.mock('../../../components/ui/Sheet', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return {
    Sheet: ({ children, headerRight, testID, visible, onAfterClose }: {
      children: React.ReactNode;
      headerRight?: React.ReactNode;
      testID?: string;
      visible: boolean;
      onAfterClose?: () => void;
    }) => visible ? ReactRuntime.createElement(View, { testID, onAfterClose }, headerRight, children) : null,
  };
});

jest.mock('../../../components/ui/Button', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({ label, onPress, testID, disabled }: { label: string; onPress: () => void; testID?: string; disabled?: boolean }) => (
      ReactRuntime.createElement(Pressable, { onPress, testID, disabled }, ReactRuntime.createElement(Text, null, label))
    ),
  };
});

jest.mock('../../../components/ui/FloatingButton', () => {
  const ReactRuntime = require('react');
  const { Pressable } = require('react-native');
  return {
    FloatingButton: ({ onPress, testID, accessibilityLabel }: { onPress: () => void; testID?: string; accessibilityLabel: string }) => (
      ReactRuntime.createElement(Pressable, { onPress, testID, accessibilityLabel })
    ),
  };
});

jest.mock('../../../components/ui/Skeleton', () => {
  const ReactRuntime = require('react');
  const { View } = require('react-native');
  return { Skeleton: (props: Record<string, unknown>) => ReactRuntime.createElement(View, { ...props, testID: 'skeleton-tile' }) };
});

jest.mock('../../../components/ui/SettingsGroup', () => {
  const ReactRuntime = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    SettingsDivider: (props: Record<string, unknown>) => ReactRuntime.createElement(View, { ...props, testID: 'sheet-divider' }),
    SettingsGroup: ({ children }: { children: React.ReactNode }) => (
      ReactRuntime.createElement(View, null, children)
    ),
    SettingsRow: ({ leading, onPress, testID, title, value, disabled }: {
      leading?: React.ReactNode;
      onPress?: () => void;
      testID?: string;
      title: string;
      value?: string;
      disabled?: boolean;
    }) => ReactRuntime.createElement(
      Pressable,
      { onPress, testID, disabled },
      leading,
      ReactRuntime.createElement(Text, null, title),
      value ? ReactRuntime.createElement(Text, { testID: `${testID}-value` }, value) : null,
    ),
  };
});

const photo = (id: string) => ({ id, uri: `file:///photos/${id}.heic`, width: 3000, height: 4000 });

function renderSheet(overrides: Partial<React.ComponentProps<typeof ThreadAddSheet>> = {}) {
  const props = {
    visible: true,
    attachmentsEnabled: true,
    skillsEnabled: true,
    onClose: jest.fn(),
    onPickImage: jest.fn(),
    onTakePhoto: jest.fn(),
    onChooseFile: jest.fn(),
    onAttachRecentPhotos: jest.fn(),
    onOpenSkills: jest.fn(),
    onOpenCommands: jest.fn(),
    onCreateScheduledTask: jest.fn(),
    onOpenTools: jest.fn(),
    onPresented: jest.fn(),
    onAction: jest.fn(),
    ...overrides,
  };
  const view = render(<ThreadAddSheet {...props} />);
  return { view, props, rerender: (next: Partial<typeof props>) => view.rerender(<ThreadAddSheet {...props} {...next} />) };
}

describe('ThreadAddSheet', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    mockRequest.mockReset();
    mockUseRecentPhotosArgs = null;
    mockRecentPhotos = { access: 'undetermined', photos: [], loading: false, request: mockRequest };
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('shows attachment tiles before photo access and gates every row by its callback', () => {
    const { view, props, rerender } = renderSheet();
    act(() => { jest.advanceTimersByTime(400); });

    expect(view.getByTestId('thread-add-tiles')).toBeTruthy();
    expect(view.getByTestId('thread-add-photo-library')).toBeTruthy();
    expect(view.getByTestId('thread-add-camera')).toBeTruthy();
    expect(view.getByTestId('thread-add-file')).toBeTruthy();
    expect(view.queryByTestId('thread-add-all-photos')).toBeNull();
    expect(view.getByTestId('thread-add-skills')).toBeTruthy();
    expect(view.getByTestId('thread-add-commands')).toBeTruthy();
    expect(view.getByTestId('thread-add-schedule')).toBeTruthy();
    expect(view.getByTestId('thread-add-tools')).toBeTruthy();
    expect(view.queryByTestId('thread-add-prompts')).toBeNull();
    expect(view.queryByTestId('thread-add-thinking')).toBeNull();
    // Media, compose rows and agent rows are three groups separated by hairlines.
    expect(view.getAllByTestId('sheet-divider')).toHaveLength(2);
    expect(props.onPresented).toHaveBeenCalledTimes(1);
    expect(props.onPresented).toHaveBeenCalledWith({ photoAccess: 'undetermined' });

    fireEvent.press(view.getByTestId('thread-add-commands'));
    expect(props.onAction).toHaveBeenCalledWith('commands', undefined);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onOpenCommands).not.toHaveBeenCalled();
    fireEvent(view.getByTestId('thread-add-sheet'), 'afterClose');
    expect(props.onOpenCommands).toHaveBeenCalledTimes(1);

    rerender({
      attachmentsEnabled: false,
      skillsEnabled: false,
      onOpenCommands: undefined,
      onCreateScheduledTask: undefined,
    });
    expect(view.queryByTestId('thread-add-tiles')).toBeNull();
    expect(view.queryByTestId('thread-add-skills')).toBeNull();
    expect(view.queryByTestId('thread-add-commands')).toBeNull();
    expect(view.queryByTestId('thread-add-schedule')).toBeNull();
    expect(view.getByTestId('thread-add-tools')).toBeTruthy();
    expect(view.queryAllByTestId('sheet-divider')).toHaveLength(0);
  });

  it('asks for photo access inline and only falls back to the system picker when refused', async () => {
    mockRequest.mockResolvedValueOnce('denied');
    const { view, props } = renderSheet();
    act(() => { jest.advanceTimersByTime(400); });

    await act(async () => {
      fireEvent.press(view.getByTestId('thread-add-photo-library'));
      await Promise.resolve();
    });
    expect(mockRequest).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent(view.getByTestId('thread-add-sheet'), 'afterClose');
    expect(props.onPickImage).toHaveBeenCalledTimes(1);

    mockRequest.mockReset();
    mockRequest.mockResolvedValueOnce('granted');
    const second = renderSheet();
    act(() => { jest.advanceTimersByTime(400); });
    await act(async () => {
      fireEvent.press(second.view.getByTestId('thread-add-photo-library'));
      await Promise.resolve();
    });
    expect(second.props.onClose).not.toHaveBeenCalled();
    expect(second.props.onPickImage).not.toHaveBeenCalled();
  });

  it('drops a permission fallback that resolves after the sheet was closed externally', async () => {
    let resolveRequest: (access: string) => void = () => undefined;
    mockRequest.mockImplementationOnce(() => new Promise((resolve) => { resolveRequest = resolve; }));
    const { view, props, rerender } = renderSheet();
    act(() => { jest.advanceTimersByTime(400); });

    fireEvent.press(view.getByTestId('thread-add-photo-library'));
    rerender({ visible: false });
    await act(async () => {
      resolveRequest('denied');
      await Promise.resolve();
    });
    expect(props.onClose).not.toHaveBeenCalled();

    rerender({ visible: true });
    act(() => { jest.advanceTimersByTime(400); });
    fireEvent.press(view.getByTestId('thread-add-skills'));
    expect(props.onClose).toHaveBeenCalledTimes(1);
    fireEvent(view.getByTestId('thread-add-sheet'), 'afterClose');
    expect(props.onOpenSkills).toHaveBeenCalledTimes(1);
    expect(props.onPickImage).not.toHaveBeenCalled();
  });

  it('keeps a skeleton strip until the sheet has risen and access is known', () => {
    mockRecentPhotos = { access: 'checking', photos: [], loading: true, request: mockRequest };
    const { view, props } = renderSheet();
    expect(view.getByTestId('thread-add-media-skeleton')).toBeTruthy();
    expect(view.queryByTestId('thread-add-tiles')).toBeNull();
    expect(props.onPresented).not.toHaveBeenCalled();
    act(() => { jest.advanceTimersByTime(400); });
    expect(view.getByTestId('thread-add-media-skeleton')).toBeTruthy();
  });

  it('renders the recent strip with ordered multi-select and attaches after dismissal', () => {
    mockRecentPhotos = { access: 'granted', photos: [photo('a'), photo('b'), photo('c')], loading: false, request: mockRequest };
    const { view, props } = renderSheet({ remainingAttachmentSlots: 2 });
    expect(view.getByTestId('thread-add-media-skeleton')).toBeTruthy();
    act(() => { jest.advanceTimersByTime(400); });

    expect(view.getByTestId('thread-add-media-strip')).toBeTruthy();
    expect(view.getByTestId('thread-add-camera')).toBeTruthy();
    expect(view.getByTestId('thread-add-all-photos')).toBeTruthy();
    expect(view.getByTestId('thread-add-file')).toBeTruthy();
    expect(view.queryByTestId('thread-add-tiles')).toBeNull();
    // The file row sits directly under the strip, inside the first row group.
    expect(view.getAllByTestId('sheet-divider')).toHaveLength(2);
    expect(view.queryByTestId('thread-add-attach-footer')).toBeNull();
    expect(props.onPresented).toHaveBeenCalledWith({ photoAccess: 'granted' });

    fireEvent.press(view.getByTestId('thread-add-photo-b'));
    fireEvent.press(view.getByTestId('thread-add-photo-a'));
    expect(view.getByTestId('thread-add-photo-b-ordinal').props.children.props.children).toBe(1);
    expect(view.getByTestId('thread-add-photo-a-ordinal').props.children.props.children).toBe(2);
    expect(view.getByTestId('thread-add-photo-c').props.disabled).toBe(true);
    expect(view.getByText('Attach 2 photos')).toBeTruthy();

    fireEvent.press(view.getByTestId('thread-add-photo-b'));
    expect(view.queryByTestId('thread-add-photo-b-ordinal')).toBeNull();
    expect(view.getByTestId('thread-add-photo-a-ordinal').props.children.props.children).toBe(1);
    expect(view.getByText('Attach 1 photo')).toBeTruthy();

    fireEvent.press(view.getByTestId('thread-add-attach-selected'));
    expect(props.onAction).toHaveBeenCalledWith('recent-photos', 1);
    expect(props.onClose).toHaveBeenCalledTimes(1);
    expect(props.onAttachRecentPhotos).not.toHaveBeenCalled();
    fireEvent(view.getByTestId('thread-add-sheet'), 'afterClose');
    expect(props.onAttachRecentPhotos).toHaveBeenCalledWith(['file:///photos/a.heic']);

    fireEvent.press(view.getByTestId('thread-add-all-photos'));
    expect(props.onAction).toHaveBeenCalledWith('photo-library', undefined);
  });

  it('does not load photos when attachments are unsupported and resets selection on close', () => {
    mockRecentPhotos = { access: 'granted', photos: [photo('a')], loading: false, request: mockRequest };
    const { view, rerender } = renderSheet({ attachmentsEnabled: false });
    act(() => { jest.advanceTimersByTime(400); });
    expect(mockUseRecentPhotosArgs).toEqual({ active: false });
    expect(view.queryByTestId('thread-add-media-strip')).toBeNull();

    rerender({ attachmentsEnabled: true });
    act(() => { jest.advanceTimersByTime(400); });
    fireEvent.press(view.getByTestId('thread-add-photo-a'));
    expect(view.getByTestId('thread-add-attach-footer')).toBeTruthy();
    rerender({ attachmentsEnabled: true, visible: false });
    rerender({ attachmentsEnabled: true, visible: true });
    act(() => { jest.advanceTimersByTime(400); });
    expect(view.queryByTestId('thread-add-attach-footer')).toBeNull();
  });
});
