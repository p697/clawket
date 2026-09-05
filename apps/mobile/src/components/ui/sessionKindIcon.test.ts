import {
  Bot,
  Clock3,
  MessageCircle,
  Radio,
  UsersRound,
} from 'lucide-react-native';

import { resolveSessionKindIcon } from './sessionKindIcon';

jest.mock('lucide-react-native', () => ({
  Bot: 'Bot',
  Clock3: 'Clock3',
  MessageCircle: 'MessageCircle',
  Radio: 'Radio',
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
