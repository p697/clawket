import { expect, it } from 'vitest';
import { DesktopIpc } from './desktop-ipc.js';
import { CodexSessionActivity } from './session-activity.js';

/** Explicit read-only smoke for the running Codex Desktop task invoking this command. */
it('observes the current native running task without requesting history or a writer', async () => {
  const id = process.env.CODEX_THREAD_ID;
  if (process.env.CLAWKET_CODEX_ACTIVITY_SMOKE !== '1' || !id || !/^[a-f0-9-]{36}$/.test(id)) {
    throw new Error('Codex activity smoke requires an active Desktop task and explicit opt-in');
  }
  const desktop = new DesktopIpc();
  const reader = new CodexSessionActivity(desktop, () => {});
  try {
    await desktop.connect();
    const key = `native:${id}`;
    const activity = (await reader.query([{ key, threadId: id }]))[0];
    expect(activity.state).toBe('running');
    expect(desktop.isObservationOnly(id)).toBe(true);
  } finally { reader.stop(); desktop.stop(); }
}, 20_000);
