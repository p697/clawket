import type { AgentAdapter } from '@clawket/agent-protocol';
import { createReplyConversation, replyConversationDraft } from './reply-conversation';
import { ManualSessions } from './manual-sessions';
import { StorageService } from './storage';
const reply = { id: 'reply', role: 'assistant' as const, text: 'A useful answer' };
jest.mock('./manual-sessions', () => ({ ManualSessions: { create: jest.fn() } }));
jest.mock('./storage', () => ({ StorageService: { getComposerDraft: jest.fn(), setComposerDraft: jest.fn() } }));
beforeEach(() => { jest.clearAllMocks(); jest.mocked(ManualSessions.create).mockResolvedValue({ key: 'new' } as any);
  jest.mocked(StorageService.getComposerDraft).mockResolvedValue(null); jest.mocked(StorageService.setComposerDraft).mockResolvedValue(undefined); });
const adapter = () => ({ connection: { id: 'connection' }, capabilities: { sessionCreate: true }, createSession: jest.fn(), prompt: jest.fn(), deleteSession: jest.fn() }) as unknown as AgentAdapter;
test('prepares only a selected reply and never sends or alters the original', async () => {
  const backend = adapter();
  await createReplyConversation(backend, 'agent', 'original', reply);
  expect(StorageService.setComposerDraft).toHaveBeenCalledWith('agent', 'new', reply.text, 'connection');
  expect(backend.prompt).not.toHaveBeenCalled(); expect(backend.deleteSession).not.toHaveBeenCalled();
});
test('a failed draft write retries the returned session and overlapping taps share one operation', async () => {
  const backend = adapter(); jest.mocked(StorageService.setComposerDraft).mockRejectedValueOnce(new Error('disk full'));
  const first = createReplyConversation(backend, 'agent', 'original', reply);
  expect(createReplyConversation(backend, 'agent', 'original', reply)).toBe(first);
  await expect(first).rejects.toThrow('disk full');
  await createReplyConversation(backend, 'agent', 'original', reply);
  expect(ManualSessions.create).toHaveBeenCalledTimes(1);
});
test('never overwrites an existing target draft or accepts the original as its target', async () => {
  jest.mocked(StorageService.getComposerDraft).mockResolvedValue('A different draft');
  await expect(createReplyConversation(adapter(), 'agent', 'original', reply)).rejects.toThrow('conflict');
  jest.mocked(ManualSessions.create).mockResolvedValue({ key: 'original' } as any);
  await expect(createReplyConversation(adapter(), 'agent', 'original', reply)).rejects.toThrow('invalid_target');
  expect(StorageService.setComposerDraft).not.toHaveBeenCalled();
});
test('requires a complete bounded assistant reply and a supported backend', async () => {
  for (const message of [{ ...reply, streaming: true }, { ...reply, text: 'x'.repeat(24_001) }, { ...reply, role: 'user' as const }]) expect(replyConversationDraft(message)).toBeNull();
  const backend = adapter(); backend.capabilities.sessionCreate = false;
  await expect(createReplyConversation(backend, 'agent', 'original', reply)).rejects.toThrow('unavailable');
  expect(ManualSessions.create).not.toHaveBeenCalled();
});
