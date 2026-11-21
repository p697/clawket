import { localizeSendFailure } from './sendFailureNotice';

const t = (key: string, options: { ns: 'chat' }) => `${options.ns}:${key}`;
const generic = 'chat:Sending failed. Check the conversation before trying again.';

describe('localizeSendFailure', () => {
  it.each([
    ['This conversation is in use by Codex on your computer. Send again when it is idle there.', 'in use on your computer'],
    ['This conversation is controlled by another Codex process. Continue there or release it before trying again.', 'in use on your computer'],
    ['This conversation is still open in Claude. Close that conversation on your computer, then try again.', 'in use on your computer'],
    ['A native task may still be running. Continue it on your computer.', 'A task may still be running'],
    ['Claude Code did not start in this folder. If your Mac is asking whether it may access the folder, allow it on the computer, then send again.', 'asking for access to the folder'],
    ['Claude Code could not initialize. Check native authentication and configuration.', 'Check its sign-in'],
    ['Codex Desktop is unavailable. Open it on your computer to continue this conversation.', 'Update Clawket on your computer'],
  ])('names the reason for %s', (details, expected) => {
    const text = localizeSendFailure(details, t);
    expect(text).toContain(expected);
    expect(text).not.toBe(generic);
  });

  it.each([
    null, undefined, '', 'Claude Code request timed out', 'Codex request timed out',
    'This conversation is in use by Codex on your computer.',
    'this conversation is in use by codex on your computer. send again when it is idle there.',
    ' This conversation is in use by Codex on your computer. Send again when it is idle there.',
    'Prefix: A native task may still be running. Continue it on your computer.',
  ])('keeps the generic line for anything else (%s)', details => {
    expect(localizeSendFailure(details, t)).toBe(generic);
  });
});
