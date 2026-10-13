import React from 'react';
import { act, fireEvent, render, waitFor, within } from '@testing-library/react-native';
import { Alert, I18nManager, Platform, StyleSheet } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import { saveToLibraryAsync } from 'expo-media-library/legacy';
import { shareAsync } from 'expo-sharing';
import { requestPhotoLibraryWritePermission } from '../../services/photo-library-permissions';
import { ControlSize, Space } from '../../theme/tokens';
import { ChatSharePosterModal } from './ChatSharePosterModal';

let mockNativeCaptureSize = { width: 0, height: 0 };
let mockDeferMeasure = false;
const mockMeasurements: Array<() => void> = [];
let mockFrame = { x: 0, y: 0, width: 720, height: 800 };
let mockInsets = { top: 20, bottom: 24, left: 48, right: 0 };
jest.mock('../ui/PresentationSafeAreaProvider', () => ({ PresentationSafeAreaProvider: ({ children }: React.PropsWithChildren) => children }));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaFrame: () => mockFrame, useSafeAreaInsets: () => mockInsets }));
jest.mock('react-native', () => {
  const R = require('react');
  const host = (name: string) => R.forwardRef(({ children, ...props }: Record<string, unknown>, ref: unknown) => {
    R.useImperativeHandle(ref, () => ({ testID: props.testID, measure: (done: (...values: number[]) => void) => {
      const size = { ...mockNativeCaptureSize };
      const deliver = () => done(0, 0, size.width, size.height, 0, 0);
      if (mockDeferMeasure) mockMeasurements.push(deliver); else deliver();
    } }), [props.testID]);
    return R.createElement(name, props, children);
  });
  const { Animated } = require('../../../__mocks__/native-animated');
  return {
    Animated: { ...Animated, spring: jest.fn(() => ({ start: jest.fn() })) },
    I18nManager: { isRTL: false }, Platform: { OS: 'ios', select: (v: any) => v.ios ?? v.default },
    View: host('View'), Text: host('Text'), Image: host('Image'), Pressable: host('Pressable'),
    ScrollView: host('ScrollView'), TouchableOpacity: host('TouchableOpacity'), ActivityIndicator: host('ActivityIndicator'),
    Switch: host('Switch'), Modal: ({ visible, children }: any) => visible ? children : null,
    Alert: { alert: jest.fn() },
    StyleSheet: { create: (v: unknown) => v, flatten: (v: unknown) => Object.assign({}, ...[v].flat(Infinity).filter(Boolean)),
      absoluteFill: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }, hairlineWidth: 1 },
  };
});
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { resolvedLanguage: 'en' } }) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ accentId: 'iceBlue', theme: { colors: {}, scheme: 'light' } }) }));
jest.mock('react-native-view-shot', () => ({ captureRef: jest.fn() }));
jest.mock('expo-media-library/legacy', () => ({ saveToLibraryAsync: jest.fn() }));
jest.mock('expo-sharing', () => ({ shareAsync: jest.fn() }));
jest.mock('../../services/photo-library-permissions', () => ({ requestPhotoLibraryWritePermission: jest.fn() }));
jest.mock('react-native-enriched-markdown', () => ({ EnrichedMarkdownText: (props: unknown) => require('react').createElement('Markdown', props) }));
jest.mock('./chatMarkdown', () => ({ getChatMarkdownFlavor: () => 'commonmark', CHAT_MARKDOWN_BREAK_STRATEGY: 'balanced', openChatMarkdownLink: jest.fn() }));
jest.mock('../ui/AgentAvatar', () => ({ getAgentInitials: () => 'QA' }));
jest.mock('../ui/PlatformMark', () => ({ isProductFacePlatform: () => false, PlatformDisc: () => null }));
jest.mock('lucide-react-native', () => ({ Download: () => null, Share2: () => null, X: () => null }));

const props = { visible: true, onClose: jest.fn(), agentName: 'QA', messageText: 'A complete test message', modelLabel: 'Test model' };
beforeEach(() => {
  jest.clearAllMocks();
  mockNativeCaptureSize = { width: 0, height: 0 }; mockDeferMeasure = false; mockMeasurements.length = 0;
  mockFrame = { x: 0, y: 0, width: 720, height: 800 };
  mockInsets = { top: 20, bottom: 24, left: 48, right: 0 };
  I18nManager.isRTL = false; Platform.OS = 'ios';
  (captureRef as jest.Mock).mockReset().mockResolvedValue('/tmp/poster.png');
  (requestPhotoLibraryWritePermission as jest.Mock).mockResolvedValue(true);
  (saveToLibraryAsync as jest.Mock).mockResolvedValue(undefined);
  (shareAsync as jest.Mock).mockResolvedValue(undefined);
});
function measure(view: ReturnType<typeof render>, width?: number) {
  const target = view.getByTestId('chat-share-poster-capture', { includeHiddenElements: true });
  mockNativeCaptureSize = { width: width ?? StyleSheet.flatten(target.props.style).width, height: 2400 };
  fireEvent(target, 'layout', { nativeEvent: { layout: { x: -9999, y: 0, ...mockNativeCaptureSize } } });
}

it.each([false, true])('keeps local safe edges, full export content and theme/model state through short and narrow windows (RTL=%s)', (rtl) => {
  I18nManager.isRTL = rtl;
  const view = render(<ChatSharePosterModal {...props} />);
  const target = view.getByTestId('chat-share-poster-capture', { includeHiddenElements: true });
  const preview = view.getByTestId('chat-share-poster-preview');
  const picker = view.getByTestId('poster-theme-picker');
  const model = view.getByTestId('chat-share-poster-model');
  fireEvent(model, 'valueChange', false);
  fireEvent.press(view.getByTestId('poster-theme-trigger'));
  fireEvent.press(view.getByTestId('poster-theme-rosePink'));
  fireEvent.press(view.getByTestId('poster-theme-trigger'));
  const palette = view.getByTestId('poster-theme-palette');
  for (const [width, height, left, right] of [[720, 600, 0, 48], [300, 240, 48, 0], [300, 90, 0, 48]]) {
    mockFrame = { x: 13, y: 7, width, height };
    mockInsets = { top: 20, bottom: 24, left, right };
    view.rerender(<ChatSharePosterModal {...props} />);
    expect(view.getByTestId('chat-share-poster-capture', { includeHiddenElements: true })).toBe(target);
    expect(view.getByTestId('chat-share-poster-preview')).toBe(preview);
    expect(view.getByTestId('poster-theme-picker')).toBe(picker);
    expect(view.getByTestId('poster-theme-palette')).toBe(palette);
    expect(view.getByTestId('poster-theme-rosePink').props.accessibilityState.selected).toBe(true);
    expect(view.getByTestId('chat-share-poster-model')).toBe(model);
    expect(model.props.value).toBe(false);
    expect(within(target).queryByText('Test model')).toBeNull();
    const safe = StyleSheet.flatten(view.getByTestId('chat-share-poster-safe-area').props.style);
    expect(safe).toMatchObject({ paddingTop: 20 + Space.lg, paddingBottom: 24 + Space.lg,
      paddingStart: (rtl ? right : left) + Space.xl, paddingEnd: (rtl ? left : right) + Space.xl });
    const exportStyle = StyleSheet.flatten(target.props.style);
    expect(exportStyle.width).toBe(Math.min(360, width - left - right - Space.xl * 2));
    expect(exportStyle.height).toBeUndefined();
    expect(exportStyle.maxHeight).toBeUndefined();
    expect(StyleSheet.flatten(preview.props.style).width).toBe(exportStyle.width);
    expect(view.getByTestId('chat-share-poster-preview-scroll').props.style.maxHeight).toBe(Math.max(0, height - 44 - Space.lg * 2) * 0.6);
    expect(target.props.accessibilityElementsHidden).toBe(true);
    expect(within(view.getByTestId('chat-share-poster-controls-scroll')).queryByTestId('chat-share-poster-capture', { includeHiddenElements: true })).toBeNull();
  }
  expect(StyleSheet.flatten(view.getByTestId('chat-share-poster-close').props.style)).toMatchObject({ width: ControlSize.floatingButton, height: ControlSize.floatingButton });
  expect(StyleSheet.flatten(palette.props.style).position).toBeUndefined();
  expect(StyleSheet.flatten(palette.props.style).flexWrap).toBe('wrap');
  expect(view.getByTestId('poster-theme-rosePink').props.style.width).toBe(ControlSize.floatingButton);
  fireEvent.press(view.getByTestId('chat-share-poster-close'));
  fireEvent.press(view.getByTestId('chat-share-poster-backdrop'));
  expect(props.onClose).toHaveBeenCalledTimes(2);
});

it('waits for the current capture width before accepting an export, then preserves a single pending save across resize', async () => {
  let finish!: (uri: string) => void;
  (captureRef as jest.Mock).mockReturnValueOnce(new Promise<string>(resolve => { finish = resolve; }));
  const view = render(<ChatSharePosterModal {...props} />);
  expect(view.getByTestId('chat-share-poster-save').props.disabled).toBe(true);
  fireEvent.press(view.getByTestId('chat-share-poster-save'));
  expect(captureRef).not.toHaveBeenCalled();
  measure(view);
  mockFrame = { ...mockFrame, width: 320 };
  view.rerender(<ChatSharePosterModal {...props} />);
  expect(view.getByTestId('chat-share-poster-save').props.disabled).toBe(true);
  measure(view, 360); // A stale layout event must not unlock the resized capture.
  expect(view.getByTestId('chat-share-poster-share').props.disabled).toBe(true);
  measure(view);
  fireEvent.press(view.getByTestId('chat-share-poster-save'));
  await waitFor(() => expect(captureRef).toHaveBeenCalledTimes(1));
  const captureTarget = (captureRef as jest.Mock).mock.calls[0][0];
  expect(captureTarget.testID).toBe('chat-share-poster-capture');
  mockFrame = { ...mockFrame, width: 720, height: 280 };
  view.rerender(<ChatSharePosterModal {...props} />);
  measure(view);
  fireEvent.press(view.getByTestId('chat-share-poster-save'));
  fireEvent.press(view.getByTestId('chat-share-poster-share'));
  expect(captureRef).toHaveBeenCalledTimes(1);
  expect(view.getByTestId('chat-share-poster-share').props.disabled).toBe(true);
  await act(async () => { finish('/tmp/poster.png'); });
  expect(saveToLibraryAsync).toHaveBeenCalledWith('file:///tmp/poster.png');
  expect(shareAsync).not.toHaveBeenCalled();
  expect(view.getByTestId('chat-share-poster-save').props.disabled).toBe(false);
});

it('preserves iOS capture fallback and hands the complete export to native sharing once', async () => {
  (captureRef as jest.Mock).mockRejectedValueOnce(new Error('native hierarchy unavailable'));
  let finish!: () => void;
  (shareAsync as jest.Mock).mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
  const view = render(<ChatSharePosterModal {...props} />);
  measure(view);
  fireEvent.press(view.getByTestId('chat-share-poster-share'));
  await waitFor(() => expect(shareAsync).toHaveBeenCalledTimes(1));
  expect(captureRef).toHaveBeenNthCalledWith(2, (captureRef as jest.Mock).mock.calls[0][0], { format: 'png', quality: 1, useRenderInContext: true });
  mockInsets = { ...mockInsets, left: 0, right: 48 };
  view.rerender(<ChatSharePosterModal {...props} />);
  fireEvent.press(view.getByTestId('chat-share-poster-share'));
  expect(shareAsync).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(view.getByTestId('chat-share-poster-share').props.disabled).toBe(false);
});

it('releases the save lock after photo permission is denied without capturing', async () => {
  (requestPhotoLibraryWritePermission as jest.Mock).mockResolvedValue(false);
  const view = render(<ChatSharePosterModal {...props} />);
  measure(view);
  fireEvent.press(view.getByTestId('chat-share-poster-save'));
  await waitFor(() => expect(Alert.alert).toHaveBeenCalledWith('Permission denied'));
  expect(captureRef).not.toHaveBeenCalled();
  expect(view.getByTestId('chat-share-poster-save').props.disabled).toBe(false);
});


it('re-measures a coalesced A-B-A size change and ignores the old native callback', () => {
  const view = render(<ChatSharePosterModal {...props} />);
  measure(view);
  mockDeferMeasure = true;
  mockFrame = { ...mockFrame, width: 320 };
  view.rerender(<ChatSharePosterModal {...props} />);
  mockFrame = { ...mockFrame, width: 720 };
  view.rerender(<ChatSharePosterModal {...props} />);
  expect(mockMeasurements).toHaveLength(2);
  expect(view.getByTestId('chat-share-poster-save').props.disabled).toBe(true);
  act(() => { mockMeasurements[0](); });
  expect(view.getByTestId('chat-share-poster-save').props.disabled).toBe(true);
  act(() => { mockMeasurements[1](); });
  expect(view.getByTestId('chat-share-poster-save').props.disabled).toBe(false);
});

it('waits for the same resized target after a delayed permission response', async () => {
  let grant!: (value: boolean) => void;
  (requestPhotoLibraryWritePermission as jest.Mock).mockReturnValueOnce(new Promise<boolean>(resolve => { grant = resolve; }));
  const view = render(<ChatSharePosterModal {...props} />);
  measure(view);
  fireEvent.press(view.getByTestId('chat-share-poster-save'));
  mockFrame = { ...mockFrame, width: 320 };
  view.rerender(<ChatSharePosterModal {...props} />);
  await act(async () => { grant(true); });
  expect(captureRef).not.toHaveBeenCalled();
  expect(saveToLibraryAsync).not.toHaveBeenCalled();
  expect(view.getByTestId('chat-share-poster-save').props.disabled).toBe(true);
  measure(view);
  await waitFor(() => expect(saveToLibraryAsync).toHaveBeenCalledTimes(1));
  expect(requestPhotoLibraryWritePermission).toHaveBeenCalledTimes(1);
});

it('does not let an old permission response export a newly opened message', async () => {
  let grant!: (value: boolean) => void;
  (requestPhotoLibraryWritePermission as jest.Mock).mockReturnValueOnce(new Promise<boolean>(resolve => { grant = resolve; }));
  const view = render(<ChatSharePosterModal {...props} />);
  measure(view);
  fireEvent.press(view.getByTestId('chat-share-poster-save'));
  view.rerender(<ChatSharePosterModal {...props} visible={false} />);
  view.rerender(<ChatSharePosterModal {...props} messageText="A different message" />);
  measure(view);
  await act(async () => { grant(true); });
  expect(captureRef).not.toHaveBeenCalled();
  expect(saveToLibraryAsync).not.toHaveBeenCalled();
  expect(Alert.alert).not.toHaveBeenCalled();
  fireEvent.press(view.getByTestId('chat-share-poster-save'));
  await waitFor(() => expect(saveToLibraryAsync).toHaveBeenCalledTimes(1));
});

it('does not run the iOS fallback or share when an old capture fails after reopening', async () => {
  let fail!: (error: Error) => void;
  (captureRef as jest.Mock).mockReturnValueOnce(new Promise<string>((_resolve, reject) => { fail = reject; }));
  const view = render(<ChatSharePosterModal {...props} />);
  measure(view);
  fireEvent.press(view.getByTestId('chat-share-poster-share'));
  await waitFor(() => expect(captureRef).toHaveBeenCalledTimes(1));
  view.rerender(<ChatSharePosterModal {...props} visible={false} />);
  view.rerender(<ChatSharePosterModal {...props} messageText="A different message" />);
  measure(view);
  await act(async () => { fail(new Error('delayed native failure')); });
  expect(captureRef).toHaveBeenCalledTimes(1);
  expect(shareAsync).not.toHaveBeenCalled();
  expect(view.getByTestId('chat-share-poster-share').props.disabled).toBe(false);
});


it('cancels a pending layout wait when the presentation closes without blocking its replacement', async () => {
  let grant!: (value: boolean) => void;
  (requestPhotoLibraryWritePermission as jest.Mock).mockReturnValueOnce(new Promise<boolean>(resolve => { grant = resolve; }));
  const view = render(<ChatSharePosterModal {...props} />);
  measure(view);
  fireEvent.press(view.getByTestId('chat-share-poster-save'));
  mockFrame = { ...mockFrame, width: 320 };
  view.rerender(<ChatSharePosterModal {...props} />);
  await act(async () => { grant(true); });
  expect(captureRef).not.toHaveBeenCalled();
  view.rerender(<ChatSharePosterModal {...props} visible={false} />);
  await act(async () => {});
  view.rerender(<ChatSharePosterModal {...props} messageText="A replacement message" />);
  measure(view);
  expect(view.getByTestId('chat-share-poster-share').props.disabled).toBe(false);
  fireEvent.press(view.getByTestId('chat-share-poster-share'));
  await waitFor(() => expect(shareAsync).toHaveBeenCalledTimes(1));
  expect(saveToLibraryAsync).not.toHaveBeenCalled();
});


it('keeps a waiting save through ready-unready-ready callbacks from consecutive resizes', async () => {
  let grant!: (value: boolean) => void;
  (requestPhotoLibraryWritePermission as jest.Mock).mockReturnValueOnce(new Promise<boolean>(resolve => { grant = resolve; }));
  const view = render(<ChatSharePosterModal {...props} />);
  measure(view);
  fireEvent.press(view.getByTestId('chat-share-poster-save'));
  mockFrame = { ...mockFrame, width: 320 };
  view.rerender(<ChatSharePosterModal {...props} />);
  await act(async () => { grant(true); });
  act(() => {
    measure(view); // Ready, but the async save has not resumed yet.
    measure(view, 100); // A newer native measurement invalidates that result.
  });
  await act(async () => {});
  expect(captureRef).not.toHaveBeenCalled();
  expect(view.getByTestId('chat-share-poster-save').props.disabled).toBe(true);
  measure(view);
  await waitFor(() => expect(saveToLibraryAsync).toHaveBeenCalledTimes(1));
  expect(requestPhotoLibraryWritePermission).toHaveBeenCalledTimes(1);
});
