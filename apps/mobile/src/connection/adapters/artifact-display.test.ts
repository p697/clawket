import { artifactHistoryDisplay, artifactUpdateDisplay } from './artifact-display';
import { extractGatewayMessageText } from './gateway-session-update';

test('new clients use the display projection while the legacy payload remains intact', () => {
  const message = { id: 'm', role: 'assistant' as const, text: '[File](report.txt)', artifactDisplayText: '', attachments: [{ type: 'file' as const, mimeType: 'text/plain', artifactId: 'file_id' }] };
  expect(artifactHistoryDisplay({ key: 's', hasActiveRun: false, messages: [message] }).messages[0].text).toBe('');
  expect(message.text).toBe('[File](report.txt)');
  const update = { type: 'run_finished' as const, sessionKey: 's', runId: 'r', stopReason: 'end_turn' as const, message: { role: 'assistant' as const, content: message.text, artifactDisplayText: '', attachments: message.attachments } };
  expect((artifactUpdateDisplay(update) as typeof update).message.content).toBe('');
  expect(update.message.content).toBe(message.text);
  expect(extractGatewayMessageText([{ type: 'text', text: message.text, artifactDisplayText: '' }])).toBe('');
});

test('does not hide legacy text or ordinary messages without delivered artifact authority', () => {
  const message = { id: 'm', role: 'assistant' as const, text: 'Original', artifactDisplayText: '' };
  expect(artifactHistoryDisplay({ key: 's', hasActiveRun: false, messages: [message] }).messages[0]).toBe(message);
  expect(extractGatewayMessageText([{ type: 'text', text: 'Original' }])).toBe('Original');
});
