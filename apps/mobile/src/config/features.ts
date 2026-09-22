// Product entry flags. A hidden entry keeps its adapter, sign-in flow, screens,
// translations, and tests in place so flipping the flag restores it as-is.

/**
 * YouMind Sprite connection entry: the Onboarding "YouMind Sprite" row, the
 * "No agent yet?" YouMind website link, and the Roster "+" add-connection copy.
 * Hidden by owner decision 2026-09-20. Flip to `true` to restore the entries;
 * existing YouMind connections keep working either way.
 */
export const YOUMIND_SPRITE_ENTRY_VISIBLE = false;
