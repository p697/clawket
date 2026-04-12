import { UiMessage } from '../../../types/chat';
import { preserveOptimisticAssistantMessage } from './historyMergePolicy';

describe('preserveOptimisticAssistantMessage', () => {
  it('preserves a local optimistic user message when refreshed history is still stale', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: 'New question', timestampMs: 3_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: 'New question', timestampMs: 3_000 },
    ]);
  });

  it('drops the local optimistic user once refreshed history catches up', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: 'New question', timestampMs: 3_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'h_user_3200', role: 'user', text: 'New question', timestampMs: 3_200 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual(nextMessages);
  });

  it('drops the local optimistic user when history catches up but omits timestamp metadata', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: '你好', timestampMs: 3_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'h_user_missing_meta', role: 'user', text: '你好' },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual(nextMessages);
  });

  it('does not conflate consecutive image-only user messages during history refresh', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      {
        id: 'usr_3000',
        role: 'user',
        text: '📷 1 image',
        timestampMs: 3_000,
        imageUris: ['file:///image-b.jpg'],
      },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      {
        id: 'h_user_2900',
        role: 'user',
        text: '',
        timestampMs: 2_900,
        imageUris: ['file:///image-a.jpg'],
      },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      {
        id: 'h_user_2900',
        role: 'user',
        text: '',
        timestampMs: 2_900,
        imageUris: ['file:///image-a.jpg'],
      },
      {
        id: 'usr_3000',
        role: 'user',
        text: '📷 1 image',
        timestampMs: 3_000,
        imageUris: ['file:///image-b.jpg'],
      },
    ]);
  });

  it('drops an optimistic image-only message once matching history arrives with the same idempotency key', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      {
        id: 'usr_3000',
        role: 'user',
        text: '📷 1 image',
        idempotencyKey: 'run_same',
        timestampMs: 3_000,
        imageUris: ['file:///pending-image.jpg'],
      },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      {
        id: 'h_user_3200',
        role: 'user',
        text: '',
        idempotencyKey: 'run_same',
        timestampMs: 3_200,
        imageUris: ['file:///cached-image.jpg'],
      },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual(nextMessages);
  });

  it('does not resurrect an older optimistic slash command when later turns already exist', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'usr_3000', role: 'user', text: '/think high', timestampMs: 3_000 },
      { id: 'a2', role: 'assistant', text: 'Thinking level set to high.', timestampMs: 3_200 },
      { id: 'u3', role: 'user', text: 'Latest question', timestampMs: 10_000 },
      { id: 'a3', role: 'assistant', text: 'Latest answer', timestampMs: 11_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Older question', timestampMs: 1_000 },
      { id: 'a1', role: 'assistant', text: 'Older answer', timestampMs: 2_000 },
      { id: 'u3', role: 'user', text: 'Latest question', timestampMs: 10_000 },
      { id: 'a3', role: 'assistant', text: 'Latest answer', timestampMs: 11_000 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual(nextMessages);
  });

  it('preserves a local final message when refreshed history is still stale', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Latest answer', timestampMs: 2000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Latest answer', timestampMs: 2000 },
    ]);
  });

  it('does not preserve the local final message once history catches up', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Latest answer', timestampMs: 2000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'ast_1', role: 'assistant', text: 'Latest answer', timestampMs: 2100 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Latest answer', timestampMs: 2100 },
    ]);
  });

  it('treats normalized assistant text as the same message', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Hello,\n\nLucy.  ', timestampMs: 5000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'ast_1', role: 'assistant', text: 'Hello,\nLucy.', timestampMs: 4500 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Hello', timestampMs: 1000 },
      { id: 'final_run', role: 'assistant', text: 'Hello,\nLucy.', timestampMs: 4500 },
    ]);
  });

  it('replaces the latest assistant in the current turn when local final is newer', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u0', role: 'user', text: 'Older question', timestampMs: 1000 },
      { id: 'a0', role: 'assistant', text: 'Older answer', timestampMs: 2000 },
      { id: 'u1', role: 'user', text: 'What is the latest Expo SDK?', timestampMs: 10_000 },
      { id: 'final_run', role: 'assistant', text: 'The latest stable release is Expo SDK 55.0.5.', timestampMs: 16_000 },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u0', role: 'user', text: 'Older question', timestampMs: 1000 },
      { id: 'a0', role: 'assistant', text: 'Older answer', timestampMs: 2000 },
      { id: 'u1', role: 'user', text: 'What is the latest Expo SDK?', timestampMs: 10_000 },
      { id: 'a1', role: 'assistant', text: 'Expo releases are not managed in GitHub Releases.', timestampMs: 14_000 },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u0', role: 'user', text: 'Older question', timestampMs: 1000 },
      { id: 'a0', role: 'assistant', text: 'Older answer', timestampMs: 2000 },
      { id: 'u1', role: 'user', text: 'What is the latest Expo SDK?', timestampMs: 10_000 },
      { id: 'final_run', role: 'assistant', text: 'The latest stable release is Expo SDK 55.0.5.', timestampMs: 16_000 },
    ]);
  });

  it('collapses multiple assistant segments in the current turn into the local final', () => {
    const previousMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check OpenClaw and Clawket', timestampMs: 10_000 },
      {
        id: 'final_run',
        role: 'assistant',
        text: 'First tool complete.\nSecond tool complete.\nFinal answer.',
        timestampMs: 18_000,
      },
    ];
    const nextMessages: UiMessage[] = [
      { id: 'u1', role: 'user', text: 'Check OpenClaw and Clawket', timestampMs: 10_000 },
      { id: 'a1', role: 'assistant', text: 'First tool complete.', timestampMs: 14_000 },
      { id: 'tool1', role: 'tool', text: '', toolName: 'search', toolStatus: 'success' },
      { id: 'a2', role: 'assistant', text: 'Second tool complete.', timestampMs: 16_000 },
      { id: 'tool2', role: 'tool', text: '', toolName: 'search', toolStatus: 'success' },
    ];

    expect(preserveOptimisticAssistantMessage(previousMessages, nextMessages)).toEqual([
      { id: 'u1', role: 'user', text: 'Check OpenClaw and Clawket', timestampMs: 10_000 },
      {
        id: 'final_run',
        role: 'assistant',
        text: 'First tool complete.\nSecond tool complete.\nFinal answer.',
        timestampMs: 18_000,
      },
      { id: 'tool1', role: 'tool', text: '', toolName: 'search', toolStatus: 'success' },
      { id: 'tool2', role: 'tool', text: '', toolName: 'search', toolStatus: 'success' },
    ]);
  });
});
