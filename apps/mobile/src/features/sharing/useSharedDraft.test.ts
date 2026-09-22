import { useState } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react-native';
import { resolveCapabilities } from '@clawket/agent-protocol';
import { IncomingShareStore } from '../../services/incoming-share';
import { readFileAsBase64 } from '../../chat/chatControllerUtils';
import type { PendingImage } from '../../types/chat';
import { useSharedDraft } from './useSharedDraft';

jest.mock('../../services/incoming-share', () => ({ IncomingShareStore: { list: jest.fn(), remove: jest.fn(async () => undefined) } }));
jest.mock('../../chat/chatControllerUtils', () => ({ readFileAsBase64: jest.fn(async () => 'aGVsbG8=') }));
const list = jest.mocked(IncomingShareStore.list);
const capabilities = resolveCapabilities('openclaw');
const share = { id: 'one', fingerprint: 'hash', text: 'Shared text', createdAt: 1, files: [] };
function harness({ id = 'one', scope = 'a', ready = true, submittedAt = 0, acceptedAt = 0, acceptedText = share.text, caps = capabilities } = {}) {
  const [input, setInput] = useState('Existing draft');
  const [images, setImages] = useState<PendingImage[]>([]);
  const result = useSharedDraft({ shareId: id, scope, ready, submittedAt, acceptedAt, acceptedSubmission: { at: acceptedAt, text: acceptedText, attachmentUris: [] }, capabilities: caps, input, images, setInput, setImages });
  return { ...result, input, images, setInput };
}
beforeEach(() => { jest.clearAllMocks(); list.mockResolvedValue([share]); });
test('waits for restored draft and retains an unacknowledged submission in the inbox', async () => {
  const { result, rerender } = renderHook(harness, { initialProps: { ready: false, submittedAt: 0, acceptedAt: 0 } });
  expect(list).not.toHaveBeenCalled();
  rerender({ ready: true, submittedAt: 0, acceptedAt: 0 });
  await waitFor(() => expect(result.current.input).toBe('Existing draft\n\nShared text'));
  expect(IncomingShareStore.remove).not.toHaveBeenCalled();
  act(() => result.current.setInput(''));
  expect(IncomingShareStore.remove).not.toHaveBeenCalled();
  rerender({ ready: true, submittedAt: 2, acceptedAt: 0 });
  expect(IncomingShareStore.remove).not.toHaveBeenCalled();
  rerender({ ready: true, submittedAt: 2, acceptedAt: 1 });
  expect(IncomingShareStore.remove).not.toHaveBeenCalled();
  rerender({ ready: true, submittedAt: 2, acceptedAt: 2 });
  await waitFor(() => expect(IncomingShareStore.remove).toHaveBeenCalledWith('one'));
});
test('rejects unsupported files without partially replacing the draft', async () => {
  list.mockResolvedValue([{ ...share, files: [{ uri: 'file:///test', name: 'test.pdf', mimeType: 'application/pdf', size: 1 }] }]);
  const caps = resolveCapabilities('hermes', { documentAttachments: false });
  const { result } = renderHook(() => harness({ caps }));
  await waitFor(() => expect(result.current.failed).toBe(true));
  expect(result.current.input).toBe('Existing draft');
  expect(readFileAsBase64).not.toHaveBeenCalled();
  expect(IncomingShareStore.remove).not.toHaveBeenCalled();
});
test('ignores a late share read after leaving its destination', async () => {
  let resolve!: (value: typeof share[]) => void;
  list.mockImplementationOnce(() => new Promise((done) => { resolve = done; }));
  const { result, rerender } = renderHook(harness, { initialProps: { ready: true } });
  rerender({ ready: false });
  await act(async () => { resolve([share]); });
  expect(result.current.input).toBe('Existing draft');
});

test('does not consume a discarded share when an unrelated message is acknowledged', async () => {
  const { result, rerender } = renderHook(harness, { initialProps: { submittedAt: 0, acceptedAt: 0, acceptedText: '' } });
  await waitFor(() => expect(result.current.input).toContain(share.text));
  act(() => result.current.setInput(''));
  rerender({ submittedAt: 3, acceptedAt: 3, acceptedText: 'Unrelated new message' });
  expect(IncomingShareStore.remove).not.toHaveBeenCalled();
});

test('acknowledges the submitted share while preserving a newly typed draft', async () => {
  const { result, rerender } = renderHook(harness, { initialProps: { submittedAt: 0, acceptedAt: 0 } });
  await waitFor(() => expect(result.current.input).toContain(share.text));
  act(() => result.current.setInput('My next question'));
  rerender({ submittedAt: 5, acceptedAt: 5 });
  await waitFor(() => expect(IncomingShareStore.remove).toHaveBeenCalledWith('one'));
  expect(result.current.input).toBe('My next question');
});
