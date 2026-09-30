/**
 * The composer chip's model name (A+ chat design, 2026-09-30): the product
 * name without its provider path or vendor prefix. Claude ids read as the
 * product ("claude-sonnet-4-6" → "Sonnet 4.6"); other names stay as given.
 */
export function shortModelLabel(name: string | null | undefined): string {
  const base = name?.trim().split('/').pop()?.trim() ?? '';
  const claude = /^claude[-\s]+(opus|sonnet|haiku|fable)[-\s]+(\d+)(?:[-.](\d{1,2}))?(?:[-\s].*)?$/i.exec(base);
  if (!claude) return base;
  const family = claude[1]!.charAt(0).toUpperCase() + claude[1]!.slice(1).toLowerCase();
  return claude[3] ? `${family} ${claude[2]}.${claude[3]}` : `${family} ${claude[2]}`;
}
