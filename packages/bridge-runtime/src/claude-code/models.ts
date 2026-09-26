import type { ModelInfo as NativeModel } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo } from '@clawket/agent-protocol';

/** Keep native aliases as write identities; the resolved ID is display evidence only. */
export function claudeModels(models: NativeModel[]): ModelInfo[] {
  return models.map((model, sortOrder) => ({
    id: model.value, name: model.displayName, provider: 'anthropic', sortOrder,
    ...(model.resolvedModel?.trim() ? { resolvedModel: model.resolvedModel.trim() } : {}),
  }));
}
