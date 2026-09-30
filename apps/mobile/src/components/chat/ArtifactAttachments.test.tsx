import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Image } from 'react-native';
import { ArtifactAttachments, ArtifactProvider } from './ArtifactAttachments';
import type { ArtifactOperations } from '@clawket/agent-protocol';
jest.mock('react-native', () => {
  const ReactRuntime = require('react');
  const primitive = (name: string) => ({ children, ...props }: any) => ReactRuntime.createElement(name, props, children);
  return { ...jest.requireActual('../../../__mocks__/react-native'), View: primitive('View'), Text: primitive('Text'), ActivityIndicator: primitive('ActivityIndicator'), Pressable: primitive('Pressable'), Image: { getSize: jest.fn() } };
});
jest.mock('lucide-react-native', () => { const { View } = require('react-native'); return { Download: View, FileText: View, ImageIcon: View, RotateCcw: View, Share2: View }; });
const mockDelete = jest.fn(); const mockWrite = jest.fn(); const mockShare = jest.fn().mockResolvedValue(undefined);
jest.mock('expo-file-system', () => ({
  Paths: { cache: 'file:///cache' }, FileMode: { WriteOnly: 1 },
  Directory: class { size = 0; uri: string; name: string; constructor(parent: any, name: string) { this.name = name; this.uri = `${parent.uri ?? parent}/${name}`; } create() {} list() { return []; } delete() { mockDelete(this.uri); } },
  File: class { uri: string; constructor(parent: any, name: string) { this.uri = `${parent.uri}/${name}`; } create() {} open() { return { writeBytes: mockWrite, close: jest.fn() }; } },
}));
jest.mock('expo-sharing', () => ({ isAvailableAsync: jest.fn().mockResolvedValue(true), shareAsync: (...args: unknown[]) => mockShare(...args) }));
jest.mock('../../theme', () => ({ useAppTheme: () => ({ theme: { colors: { inkSecondary: '#999' } } }) }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('../ui/SystemEventRow', () => ({ SystemEventRow: ({ label, onPress }: any) => { const { Text } = require('react-native'); return <Text onPress={onPress}>{label}</Text>; } }));
jest.mock('./MessageAttachmentAlbum', () => ({ MessageAttachmentAlbum: ({ uris, onPressImage }: any) => { const { Text } = require('react-native'); return <Text testID="artifact-image" onPress={onPressImage}>{uris[0]}</Text>; } }));
const image = [{ type: 'image' as const, mimeType: 'image/png', artifactId: 'a' }];
const ops = (): ArtifactOperations => ({ open: jest.fn().mockResolvedValue({ id: 'h', name: 'test.png', mimeType: 'image/png', size: 1 }), read: jest.fn().mockResolvedValue({ offset: 0, total: 1, data: 'YQ==', done: true }) });
beforeEach(() => { jest.clearAllMocks(); (Image.getSize as jest.Mock).mockResolvedValue({ width: 10, height: 10 }); });
afterEach(() => jest.restoreAllMocks());
it('auto-loads an image, opens its viewer and cleans unretained cache on unmount', async () => {
  const operations = ops(); const open = jest.fn();
  const view = render(<ArtifactProvider operations={operations} sessionKey="a"><ArtifactAttachments attachments={image} maxWidth={250} onOpenImage={open} /></ArtifactProvider>);
  await waitFor(() => expect(view.getByTestId('artifact-image')).toBeTruthy());
  fireEvent.press(view.getByTestId('artifact-image')); expect(open).toHaveBeenCalledWith(expect.stringContaining('test.png'));
  expect(view.queryByText('Save')).toBeNull();
  expect(operations.open).toHaveBeenCalledTimes(1); expect(mockWrite).toHaveBeenCalledWith(new Uint8Array([97])); view.unmount();
});
it('does not show or share an old session download that completes after switching', async () => {
  let finish!: (v: any) => void; const operations = ops(); (operations.open as jest.Mock).mockImplementationOnce(() => new Promise(r => { finish = r; }));
  const view = render(<ArtifactProvider operations={operations} sessionKey="old"><ArtifactAttachments attachments={image} maxWidth={250} /></ArtifactProvider>);
  await waitFor(() => expect(operations.open).toHaveBeenCalled());
  view.rerender(<ArtifactProvider operations={undefined} sessionKey="new"><ArtifactAttachments attachments={image} maxWidth={250} /></ArtifactProvider>);
  await act(async () => finish({ id: 'h', name: 'old.png', mimeType: 'image/png', size: 1 }));
  expect(view.queryByTestId('artifact-image')).toBeNull(); expect(operations.read).not.toHaveBeenCalled(); expect(mockShare).not.toHaveBeenCalled();
});
it('downloads a document only on an explicit tap and shows a retryable failure', async () => {
  const operations = ops(); (operations.open as jest.Mock).mockRejectedValue(new Error('private backend error'));
  const view = render(<ArtifactProvider operations={operations} sessionKey="s"><ArtifactAttachments attachments={[{ type: 'file', artifactId: 'd', name: 'report.pdf', mimeType: 'application/pdf' }]} maxWidth={250} /></ArtifactProvider>);
  expect(operations.open).not.toHaveBeenCalled(); fireEvent.press(view.getByTestId('artifact-file-card'));
  await waitFor(() => expect(view.getByText('Could not retrieve files')).toBeTruthy()); expect(view.queryByText('private backend error')).toBeNull();
});

it('uses one document card to download/share and then reuses the local file', async () => {
  const operations = ops();
  (operations.open as jest.Mock).mockResolvedValue({ id: 'h', name: 'report.txt', mimeType: 'text/plain', size: 1 });
  const view = render(<ArtifactProvider operations={operations} sessionKey="s"><ArtifactAttachments attachments={[{ type: 'file', artifactId: 'd', name: 'report.txt', mimeType: 'text/plain' }]} maxWidth={250} /></ArtifactProvider>);
  fireEvent.press(view.getByTestId('artifact-file-card'));
  await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(1));
  expect(view.getByText('TXT · 1 B')).toBeTruthy();
  fireEvent.press(view.getByTestId('artifact-file-card'));
  await waitFor(() => expect(mockShare).toHaveBeenCalledTimes(2));
  expect(operations.open).toHaveBeenCalledTimes(1);
});
