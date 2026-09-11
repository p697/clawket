import type { SessionKind } from '@clawket/agent-protocol';
import type { LucideIcon } from 'lucide-react-native';
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

export function resolveSessionKindIcon(kind: SessionKind): LucideIcon {
  if (kind === 'channel') return Radio;
  if (kind === 'subagent') return Bot;
  if (kind === 'cron') return Clock3;
  if (kind === 'direct' || kind === 'group') return UsersRound;
  return MessageCircle;
}

/** Monochrome glyph for a channel session tile; unknown platforms fall back to the channel icon. */
export function resolveSessionChannelIcon(channel: string | null | undefined): LucideIcon {
  const normalized = channel?.trim().toLowerCase();
  if (normalized === 'slack') return Slack;
  if (normalized === 'discord') return Gamepad2;
  if (normalized === 'telegram') return Send;
  if (normalized === 'whatsapp') return MessageCircle;
  if (normalized === 'feishu' || normalized === 'lark') return MessageSquare;
  return Radio;
}
