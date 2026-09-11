import {
  Bot,
  Clock3,
  Gamepad2,
  MessageCircle,
  MessageSquare,
  Radio,
  Send,
  Slack,
  UsersRound,
} from 'lucide-react-native';

import { resolveSessionChannelIcon, resolveSessionKindIcon } from './sessionKindIcon';

jest.mock('lucide-react-native', () => ({
  Bot: 'Bot',
  Clock3: 'Clock3',
  Gamepad2: 'Gamepad2',
  MessageCircle: 'MessageCircle',
  MessageSquare: 'MessageSquare',
  Radio: 'Radio',
  Send: 'Send',
  Slack: 'Slack',
  UsersRound: 'UsersRound',
}));

describe('resolveSessionKindIcon', () => {
  it.each([
    ['main', MessageCircle],
    ['channel', Radio],
    ['direct', UsersRound],
    ['group', UsersRound],
    ['subagent', Bot],
    ['cron', Clock3],
    ['other', MessageCircle],
  ] as const)('maps %s sessions to the canonical icon', (kind, expected) => {
    expect(resolveSessionKindIcon(kind)).toBe(expected);
  });
});

describe('resolveSessionChannelIcon', () => {
  it.each([
    ['Slack', Slack],
    [' discord ', Gamepad2],
    ['telegram', Send],
    ['WhatsApp', MessageCircle],
    ['lark', MessageSquare],
    ['feishu', MessageSquare],
    ['matrix', Radio],
    [null, Radio],
    [undefined, Radio],
  ])('maps channel %p to a monochrome glyph', (channel, expected) => {
    expect(resolveSessionChannelIcon(channel)).toBe(expected);
  });
});
