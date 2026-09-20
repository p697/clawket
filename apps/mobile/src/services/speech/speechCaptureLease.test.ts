import { CaptureLease } from './speechCaptureLease';
it('holds new chat captures until the old native teardown completes', async () => {
  const lease = new CaptureLease();
  const first = await lease.acquire(new AbortController().signal);
  let secondStarted = false;
  const second = lease.acquire(new AbortController().signal).then(release => { secondStarted = true; return release; });
  await Promise.resolve(); expect(secondStarted).toBe(false);
  first(); (await second)(); expect(secondStarted).toBe(true);
});
it('cancelling a waiting capture neither releases its predecessor nor blocks later captures', async () => {
  const lease = new CaptureLease(), cancel = new AbortController();
  const first = await lease.acquire(new AbortController().signal);
  const second = lease.acquire(cancel.signal); cancel.abort();
  await expect(second).rejects.toThrow('speech_cancelled');
  let thirdStarted = false;
  const third = lease.acquire(new AbortController().signal).then(release => { thirdStarted = true; return release; });
  await Promise.resolve(); expect(thirdStarted).toBe(false);
  first(); (await third)(); expect(thirdStarted).toBe(true);
});
