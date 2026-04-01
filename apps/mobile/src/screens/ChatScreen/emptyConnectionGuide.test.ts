import {
  getQuickConnectAgentPrompt,
  getQuickConnectGuideSteps,
  MANUAL_PAIR_LOCAL_CMD,
} from '../../components/config/quickConnectGuide';

describe('empty connection guide', () => {
  it('exposes the agent prompt', () => {
    const t = (key: string, options?: Record<string, string>) => Object.entries(options ?? {}).reduce(
      (result, [name, value]) => result.replace(`{{${name}}}`, value),
      key,
    );

    const prompt = getQuickConnectAgentPrompt(t as never);
    expect(prompt).toContain('pnpm add -g @p697/clawket');
    expect(prompt).toContain('open-source Clawket CLI');
    expect(prompt).toContain('clawket pair');
  });

  it('supports the local pairing command in the agent prompt', () => {
    const t = (key: string, options?: Record<string, string>) => Object.entries(options ?? {}).reduce(
      (result, [name, value]) => result.replace(`{{${name}}}`, value),
      key,
    );

    const prompt = getQuickConnectAgentPrompt(t as never, MANUAL_PAIR_LOCAL_CMD);
    expect(prompt).toContain(MANUAL_PAIR_LOCAL_CMD);
  });

  it('returns the translated two-step onboarding copy', () => {
    const t = ((key: string) => key) as never;
    expect(getQuickConnectGuideSteps(t)).toEqual([
      { title: 'Step 1', description: 'Copy this message to your OpenClaw Agent.' },
      { title: 'Step 2', description: 'Scan the QR code sent by your Agent.' },
    ]);
  });
});
