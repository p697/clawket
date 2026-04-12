import type { TFunction } from 'i18next';

export const MANUAL_INSTALL_CMD = 'npm install -g @p697/clawket';
export const MANUAL_PAIR_CMD = 'clawket pair';
export const MANUAL_PAIR_LOCAL_CMD = 'clawket pair --local';
export type QuickConnectPairMode = 'relay' | 'local';

export function getQuickConnectAgentPrompt(
  t: TFunction<'chat', undefined>,
  pairCommand = MANUAL_PAIR_CMD,
): string {
  return t('Please run {{installCommand}} to install the open-source Clawket CLI, then run {{pairCommand}}, and send me the generated QR image file or files.', {
    installCommand: MANUAL_INSTALL_CMD,
    pairCommand,
  });
}

export function getQuickConnectGuideSteps(
  t: TFunction<'chat', undefined>
): Array<{ title: string; description: string }> {
  return [
    {
      title: t('Step 1'),
      description: t('Copy this message to your agent.'),
    },
    {
      title: t('Step 2'),
      description: t('Scan one of the QR codes sent by your agent.'),
    },
  ];
}
