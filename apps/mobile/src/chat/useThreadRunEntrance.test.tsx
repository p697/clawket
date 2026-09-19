import { renderHook } from '@testing-library/react-native';
import { useThreadRunEntrance } from './useThreadRunEntrance';

type Props = { keys: string[]; scope: string; visible: boolean };

function renderEntrance(initialProps: Props) {
  return renderHook<ReturnType<typeof useThreadRunEntrance>, Props>(
    ({ keys, scope, visible }) => useThreadRunEntrance(keys, scope, visible),
    { initialProps },
  );
}

describe('scheduled card entrance ownership', () => {
  it('keeps hydrated cards still and animates only a card that arrives on a visible timeline', () => {
    const view = renderEntrance({ keys: [], scope: 'session-a', visible: false });
    // Cache hydration lands together with the first ready frame: nothing moves.
    view.rerender({ keys: ['run:cron:a', 'run:cron:b'], scope: 'session-a', visible: true });
    expect(view.result.current.entranceKeys.size).toBe(0);
    expect(view.result.current.claimEntrance('run:cron:a')).toBe(false);

    // A job that finishes while reading slides in once, then stays claimed.
    view.rerender({ keys: ['run:cron:c', 'run:cron:a', 'run:cron:b'], scope: 'session-a', visible: true });
    expect([...view.result.current.entranceKeys]).toEqual(['run:cron:c']);
    expect(view.result.current.claimEntrance('run:cron:c')).toBe(true);
    expect(view.result.current.claimEntrance('run:cron:c')).toBe(false);
    view.rerender({ keys: ['run:cron:a', 'run:cron:b'], scope: 'session-a', visible: true });
    view.rerender({ keys: ['run:cron:c', 'run:cron:a', 'run:cron:b'], scope: 'session-a', visible: true });
    expect(view.result.current.claimEntrance('run:cron:c')).toBe(false);
  });

  it('treats a burst beyond the entrance budget as a reconciliation', () => {
    const view = renderEntrance({ keys: ['run:cron:a'], scope: 'session-a', visible: true });
    view.rerender({ keys: ['run:cron:b', 'run:cron:c', 'run:cron:d', 'run:cron:e', 'run:cron:a'], scope: 'session-a', visible: true });
    expect(view.result.current.entranceKeys.size).toBe(0);
  });

  it('resets on session change and ignores claims from the previous scope', () => {
    const view = renderEntrance({ keys: ['run:cron:a'], scope: 'session-a', visible: true });
    view.rerender({ keys: ['run:cron:b', 'run:cron:a'], scope: 'session-a', visible: true });
    const oldClaim = view.result.current.claimEntrance;
    expect(view.result.current.entranceKeys.has('run:cron:b')).toBe(true);
    view.rerender({ keys: ['run:cron:b', 'run:cron:a'], scope: 'session-b', visible: true });
    expect(view.result.current.entranceKeys.size).toBe(0);
    expect(oldClaim('run:cron:b')).toBe(false);
    expect(view.result.current.claimEntrance('run:cron:b')).toBe(false);
  });
});
