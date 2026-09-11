export function formatSystemErrorMessage(primaryMessage: string, rawError?: string): string {
  const primary = primaryMessage.trim();
  const raw = rawError?.trim();
  if (!raw) return primary;
  return `${primary}\nRaw Error: ${raw}`;
}
