import { extractHistoryAttachments, stripOpenClawMediaDirectives, reconcileOpenClawArtifactHistory } from './gateway-attachments';
import { mapGatewayAdapterEvent } from './gateway-session-update';
import { mapAdapterChatMessage, mapAdapterSessionUpdate } from '../../chat/useAdapterChatEvents';
jest.mock('../../i18n', () => ({ __esModule: true, default: { t: (key: string) => key } }));
const image = { type: 'image', artifactId: 'artifact_managed_image_test', url: '/api/chat/media/outgoing/private?ticket=secret', mimeType: 'image/png', sizeBytes: 3 };
it('preserves stable image and document references without persisting ticket URLs', () => {
  const attachments = extractHistoryAttachments([image, { type: 'attachment', attachment: { artifactId: 'doc', kind: 'document', label: 'report.pdf', mimeType: 'application/pdf', url: '/private' } }]);
  expect(attachments).toEqual([{ type: 'image', artifactId: image.artifactId, mimeType: 'image/png' }, { type: 'file', artifactId: 'doc', mimeType: 'application/pdf', name: 'report.pdf' }]);
  const message = mapAdapterChatMessage({ id: 'm', role: 'assistant', text: '', attachments });
  expect(message?.artifactAttachments).toEqual(attachments); expect(message?.imageUris).toBeUndefined(); expect(message?.fileAttachments).toBeUndefined();
  expect(JSON.stringify(message)).not.toContain('secret');
});
it('delivers image-only live finals through the same mapping as history', () => {
  const [update] = mapGatewayAdapterEvent({ type: 'chatFinal', payload: { runId: 'r', message: { content: [image] } } }, 'agent:main:test');
  expect(update.type).toBe('run_finished');
  expect(JSON.stringify(mapAdapterSessionUpdate(update))).toContain(image.artifactId);
});
it('preserves legacy inline images for both OpenClaw and Hermes', () => {
  expect(extractHistoryAttachments([{ type: 'image', source: { data: 'YQ==', media_type: 'image/png' } }, { type: 'image_url', image_url: { url: 'https://example.com/image.png' } }])).toEqual([
    { type: 'image', mimeType: 'image/png', content: 'YQ==' }, { type: 'image', mimeType: 'application/octet-stream', uri: 'https://example.com/image.png' },
  ]);
});
it('ignores malformed blocks and bounds untrusted references', () => {
  expect(extractHistoryAttachments([null, false, { type: 'attachment', attachment: null }, { ...image, artifactId: 'a'.repeat(513) }])).toEqual([]);
});

it('removes standalone OpenClaw delivery directives but preserves prose and fenced examples', () => {
  expect(stripOpenClawMediaDirectives('Here it is.\nMEDIA: /tmp/picture.png\nMEDIA: ./report.pdf')).toBe('Here it is.');
  expect(stripOpenClawMediaDirectives('MEDIA: /tmp/picture.png')).toBe('');
  const example = 'Use MEDIA: /tmp/picture.png to attach.\n```text\nMEDIA: /tmp/example.png\n```';
  expect(stripOpenClawMediaDirectives(example)).toBe(example);
});

it('does not drop attachments after a long sequence of text/tool blocks', () => {
  expect(extractHistoryAttachments([...Array.from({ length: 100 }, () => ({ type: 'text', text: 'x' })), image])).toEqual([{ type: 'image', mimeType: 'image/png', artifactId: image.artifactId }]);
});

it('retires old cached directives only within a turn with confirmed managed attachments', () => {
  const messages = [
    { id: 'u1', role: 'user' as const, text: 'old' },
    { id: 'a1', role: 'assistant' as const, text: 'MEDIA: /tmp/not-delivered.png' },
    { id: 'u2', role: 'user' as const, text: 'new' },
    { id: 'a2', role: 'assistant' as const, text: 'MEDIA: /tmp/delivered.png' },
    { id: 'a3', role: 'assistant' as const, text: '', attachments: [{ type: 'image' as const, mimeType: 'image/png', artifactId: 'confirmed' }] },
  ];
  expect(reconcileOpenClawArtifactHistory(messages).map(message => message.id)).toEqual(['u1', 'a1', 'u2', 'a3']);
  expect(messages[3].text).toBe('MEDIA: /tmp/delivered.png');
});

it('deduplicates paged managed deliveries by exact artifact identity within their turn', () => {
  const ref = [{ type: 'image' as const, mimeType: 'image/png', artifactId: 'artifact_managed_image_same' }];
  const user = { id: 'u', role: 'user' as const, text: 'Send' };
  const imported = { id: 'imported', role: 'assistant' as const, text: 'Here\n', attachments: ref };
  const rollup = { ...imported, id: 'rollup', text: 'Here' };
  const newDelivery = { ...rollup, id: 'other', attachments: [{ ...ref[0], artifactId: 'artifact_managed_image_other' }] };
  const result = reconcileOpenClawArtifactHistory([user, imported, rollup, newDelivery, { ...user, id: 'next' }, { ...rollup, id: 'next-reply' }]);
  expect(result.map(m => m.id)).toEqual(['u', 'rollup', 'other', 'next', 'next-reply']);
  expect(imported.text).toBe('Here\n');
  expect(reconcileOpenClawArtifactHistory([user, imported, { ...rollup, text: 'Another point' }])).toHaveLength(3);
});
