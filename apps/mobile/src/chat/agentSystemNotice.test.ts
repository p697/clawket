import { localizeAgentSystemNotice } from './agentSystemNotice';

const notices = [
  'Model authentication failed. Sign in again on your computer.',
  'The model account has insufficient credits or quota.',
  'The model is rate limited. Try again shortly.',
  'This model is unavailable in the current Codex runtime. Choose another model or update Codex on your computer.',
  "The agent couldn't complete this reply. Please try again.",
];

it.each(notices)('localizes only the fixed chat notice: %s', (notice) => {
  const translate = jest.fn((key: string) => `current-language:${key}`);
  expect(localizeAgentSystemNotice(notice, translate)).toBe(`current-language:${notice}`);
  expect(translate).toHaveBeenCalledTimes(1);
  expect(translate).toHaveBeenCalledWith(notice, { ns: 'chat' });
});

it.each([
  'Connection restored',
  'Provider error: unauthorized',
  'Model authentication failed. Sign in again on your computer. ',
  'localized:Model authentication failed. Sign in again on your computer.',
  '',
])('preserves ordinary, partial and already localized system text: %s', (text) => {
  const translate = jest.fn();
  expect(localizeAgentSystemNotice(text, translate)).toBe(text);
  expect(translate).not.toHaveBeenCalled();
});
