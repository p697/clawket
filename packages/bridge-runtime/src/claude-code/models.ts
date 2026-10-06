import type { ModelInfo as NativeModel } from '@anthropic-ai/claude-agent-sdk';
import type { ModelInfo } from '@clawket/agent-protocol';

export function claudeModelId(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const model = value.trim();
  return model.length > 0 && model.length <= 300 && !/[\s<>\x00-\x1f\x7f]/.test(model) ? model : undefined;
}

export function claudeModelValue(models: NativeModel[], current?: string, selected?: string): string {
  if (!current) return '';
  const explicit = models.find(model => model.value === selected && (model.value === current || model.resolvedModel === current));
  return (explicit ?? models.find(model => model.value === current) ?? models.find(model => model.resolvedModel === current))?.value ?? current ?? '';
}

/** Keep native aliases as write identities; the resolved ID is display evidence only. */
export function claudeModels(models: NativeModel[]): ModelInfo[] {
  return models.map((model, sortOrder) => ({
    id: model.value, name: model.displayName, provider: 'anthropic', sortOrder,
    ...(model.resolvedModel?.trim() ? { resolvedModel: model.resolvedModel.trim() } : {}),
  }));
}
