// Product entry flags. A hidden entry keeps its adapter, sign-in flow, screens,
// translations, and tests in place so flipping the flag restores it as-is.

/**
 * YouMind Sprite connection entry: the Onboarding "YouMind Sprite" row, the
 * "No agent yet?" YouMind website link, and the Roster "+" add-connection copy.
 * Hidden by owner decision 2026-09-14, restored by owner decision 2026-09-17.
 * Flip to `false` to hide every entry again; existing YouMind connections keep
 * working either way, only the ways to create a new one are gated.
 */
export const YOUMIND_SPRITE_ENTRY_VISIBLE = true;
