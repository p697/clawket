import React from 'react';
import { useTranslation } from 'react-i18next';
import type { DeepLinkConfirmationRequest } from '../hooks/useDeepLinkHandler';
import { ConfirmationModal } from './ui';

export type DeepLinkConfirmationModalProps = Readonly<{
  request: DeepLinkConfirmationRequest | null;
  onClose: () => void;
}>;

export function DeepLinkConfirmationModal({
  request,
  onClose,
}: DeepLinkConfirmationModalProps): React.JSX.Element | null {
  const { t } = useTranslation('common');
  if (!request) return null;

  const message = request.action.type === 'agent'
    ? t('Send "{{message}}" to this agent?', { message: request.action.message })
    : request.action.type === 'session'
      ? t('Open session "{{session}}"?', { session: request.action.key })
      : request.action.type === 'config'
        ? t('Open settings?')
        : t('Connect to {{url}}?', { url: request.action.url });
  const confirm = () => {
    onClose();
    request.onConfirm();
  };

  return (
    <ConfirmationModal
      visible
      title={t('Confirm')}
      message={message}
      cancelLabel={t('Cancel')}
      confirmLabel={t('Confirm')}
      onClose={onClose}
      onConfirm={confirm}
      destructive={request.action.type === 'connect'}
      testID="deep-link-confirmation"
    />
  );
}
