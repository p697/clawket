import type { SessionKind } from '@clawket/agent-protocol';
import type { LucideIcon } from 'lucide-react-native';
import {
  Bot,
  Clock3,
  MessageCircle,
  Radio,
  UsersRound,
} from 'lucide-react-native';

export function resolveSessionKindIcon(kind: SessionKind): LucideIcon {
  if (kind === 'channel') return Radio;
  if (kind === 'subagent') return Bot;
  if (kind === 'cron') return Clock3;
  if (kind === 'direct' || kind === 'group') return UsersRound;
  return MessageCircle;
}
