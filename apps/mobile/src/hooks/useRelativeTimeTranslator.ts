import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import type { RelativeTimeTranslator } from '../utils/chat-message';

/** Localized compact labels for `relativeTime`; literal keys keep the catalog prunable. */
export function useRelativeTimeTranslator(): RelativeTimeTranslator {
  const { t } = useTranslation('common');
  return useCallback<RelativeTimeTranslator>((key, count) => {
    switch (key) {
      case 'just now':
        return t('just now');
      case '{{count}}m ago':
        return t('{{count}}m ago', { count });
      case '{{count}}h ago':
        return t('{{count}}h ago', { count });
      case 'Yesterday':
        return t('Yesterday');
      case '{{count}}d ago':
        return t('{{count}}d ago', { count });
      case '{{count}}w ago':
        return t('{{count}}w ago', { count });
      case '{{count}}mo ago':
        return t('{{count}}mo ago', { count });
    }
  }, [t]);
}
