import { ChatHeaderStatusKind } from './chatSyncPolicy';

type Translate = (key: string) => string;

export function getChatHeaderStatusLabel(
  status: ChatHeaderStatusKind | null,
  t: Translate,
): string | null {
  if (status === 'starting_hermes') return t('Starting Hermes, this may take a few seconds.');
  if (status === 'connecting_gateway') return t('Connecting to gateway...');
  if (status === 'reconnecting') return t('Reconnecting...');
  if (status === 'connecting') return t('Connecting...');
  if (status === 'waiting_for_approval') return t('Waiting for approval...');
  if (status === 'refreshing_conversation') return t('Refreshing conversation...');
  if (status === 'syncing_conversation') return t('Syncing conversation...');
  return null;
}
