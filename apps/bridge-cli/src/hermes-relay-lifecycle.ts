export async function keepHermesRelayRuntimeAlive(runtime: { stop(): Promise<void> }): Promise<void> {
  // A pending Promise alone does not keep Node alive. Preserve a yielded owner
  // for diagnostics until explicit shutdown, so the watchdog cannot respawn it.
  const keepAlive = setInterval(() => {}, 60_000);
  const shutdown = async () => {
    clearInterval(keepAlive);
    process.off('SIGINT', shutdown);
    process.off('SIGTERM', shutdown);
    await runtime.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  await new Promise<void>(() => {});
}
