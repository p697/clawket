export type ComposerClearTrigger = 'send-button' | 'slash-command' | 'model-picker' | 'command-picker';

export function shouldClearComposerInput(trigger: ComposerClearTrigger): boolean {
  return trigger === 'send-button';
}
