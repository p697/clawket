// Product entry flags. A hidden entry keeps its adapter, sign-in flow, screens,
// translations, and tests in place so flipping the flag restores it as-is.

/**
 * YouMind Sprite connection entry: the Onboarding "YouMind Sprite" row, the
 * "No agent yet?" YouMind website link, and the Roster "+" add-connection copy.
 * Owner decision 2026-09-14: hide every entry. Existing YouMind connections keep
 * working; only the ways to create a new one are hidden.
 */
export const YOUMIND_SPRITE_ENTRY_VISIBLE = false;
