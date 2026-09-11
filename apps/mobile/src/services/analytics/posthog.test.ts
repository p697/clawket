import {
  getPostHogDiagnostics,
  recordPostHogDiagnosticEvent,
} from './posthog';

describe('PostHog diagnostics', () => {
  it('keeps a detached copy of only the latest twenty semantic events', () => {
    const mutable = { index: 0 };
    for (let index = 0; index < 22; index += 1) {
      mutable.index = index;
      recordPostHogDiagnosticEvent(index % 2 === 0 ? 'event' : 'screen', `entry_${index}`, mutable);
    }
    mutable.index = 999;

    const diagnostics = getPostHogDiagnostics();
    expect(diagnostics.recentEvents).toHaveLength(20);
    expect(diagnostics.recentEvents[0]).toEqual({
      kind: 'event',
      name: 'entry_2',
      properties: { index: 2 },
    });
    expect(diagnostics.recentEvents[19]).toEqual({
      kind: 'screen',
      name: 'entry_21',
      properties: { index: 21 },
    });

    (diagnostics.recentEvents[0].properties as { index: number }).index = 500;
    expect(getPostHogDiagnostics().recentEvents[0]?.properties.index).toBe(2);
  });
});
