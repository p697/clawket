import type { ModelHealthReport } from '@clawket/agent-protocol';
import { isRecord, readString } from './internal.js';

export async function supportsHermesModelHealth(run: <T>(script: string) => Promise<T>): Promise<boolean> {
  try {
    return await run<unknown>('from hermes_cli.auth import get_auth_status, PROVIDER_REGISTRY\nfrom hermes_cli.doctor_connectivity import build_probes, run_probes\nprint("true")') === true;
  } catch { return false; }
}

export const MODEL_HEALTH_SCRIPT = `
import contextlib, io, json, os, re, sys, time
payload = json.loads(sys.stdin.read() or '{}')
with contextlib.redirect_stdout(io.StringIO()):
    from hermes_cli.auth import get_auth_status, PROVIDER_REGISTRY
    from hermes_cli.config import load_config
    from dotenv import load_dotenv
    load_dotenv(os.path.join(os.environ['HERMES_HOME'], '.env'))
    cfg = load_config()
    model = cfg.get('model') or {}
    provider = str(model.get('provider') or '') if isinstance(model, dict) else ''
    model_name = str(model.get('default') or '') if isinstance(model, dict) else str(model)
    providers = []
    for slug, definition in list(PROVIDER_REGISTRY.items())[:100]:
        try:
            status = get_auth_status(slug)
            configured = status.get('configured', status.get('logged_in'))
            if configured is True or slug == provider:
                providers.append({'id': slug, 'name': str(getattr(definition, 'name', slug)),
                                  'credentials': 'configured' if configured is True else 'missing' if configured is False else 'unknown'})
        except Exception:
            if slug == provider: providers.append({'id': slug, 'name': slug, 'credentials': 'unknown'})
    if provider and not any(row['id'] == provider for row in providers):
        providers.insert(0, {'id': provider, 'name': provider, 'credentials': 'unknown'})
    checks = []
    if payload.get('probe') is True:
        from hermes_cli.doctor_connectivity import build_probes, run_probes
        for result in run_probes(build_probes()[:100]):
            if not result.lines: continue
            states = []
            for glyph, label, detail in result.lines:
                glyph = re.sub(r'\\x1b\\[[0-9;]*m', '', str(glyph))
                detail = re.sub(r'\\x1b\\[[0-9;]*m', '', str(detail))
                states.append('failed' if '✗' in glyph else 'configured' if 'key configured' in detail else 'reachable' if '✓' in glyph else 'unknown')
            state = 'failed' if 'failed' in states else 'unknown' if 'unknown' in states else states[0]
            checks.append({'name': str(result.label), 'status': state})
print(json.dumps({'scope': 'global', 'model': model_name, 'provider': provider,
                  'providers': providers, 'checks': checks, 'checkedAtMs': int(time.time() * 1000)}))
`;

/** Native doctor probes only configured providers; no chat, tool execution or config writes. */
export async function readHermesModelHealth(
  run: <T>(script: string, payload?: unknown) => Promise<T>, probe: boolean,
): Promise<ModelHealthReport> {
  const value = await run<unknown>(MODEL_HEALTH_SCRIPT, { probe });
  if (!isRecord(value) || !Array.isArray(value.providers) || !Array.isArray(value.checks)
      || value.providers.length > 100 || value.checks.length > 100 || !Number.isFinite(value.checkedAtMs)) throw new Error('Invalid model health response.');
  return {
    scope: 'global', model: readString(value.model).slice(0, 256), provider: readString(value.provider).slice(0, 128),
    checkedAtMs: Number(value.checkedAtMs),
    providers: value.providers.map(entry => {
      if (!isRecord(entry) || !['configured', 'missing', 'unknown'].includes(String(entry.credentials))) throw new Error('Invalid provider status.');
      return { id: readString(entry.id).slice(0, 128), name: readString(entry.name).slice(0, 128), credentials: entry.credentials as 'configured' | 'missing' | 'unknown' };
    }),
    checks: value.checks.map(entry => {
      if (!isRecord(entry) || !['reachable', 'configured', 'failed', 'unknown'].includes(String(entry.status))) throw new Error('Invalid connection check.');
      return { name: readString(entry.name).slice(0, 128), status: entry.status as 'reachable' | 'configured' | 'failed' | 'unknown' };
    }),
  };
}
