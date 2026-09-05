import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import type { HermesBridgeSessionStore } from './session-store.js';
import {
  HERMES_MODEL_STATE_CACHE_TTL_MS,
  SLOW_BRIDGE_REQUEST_LOG_THRESHOLD_MS,
  formatError,
  isRecord,
  readBoolean,
  readNumber,
  readString,
} from './internal.js';

type HermesProviderListing = {
  slug: string;
  name: string;
  isCurrent: boolean;
  models: string[];
  totalModels: number;
  source?: string;
  apiUrl?: string;
};

type HermesModelDescriptor = {
  id: string;
  name: string;
  provider: string;
};

export type HermesModelState = {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  providers: HermesProviderListing[];
  models: HermesModelDescriptor[];
};

export type HermesCurrentModelState = {
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  note?: string | null;
};

export type HermesModelSetResult = {
  ok: boolean;
  scope: 'global';
  currentModel: string;
  currentProvider: string;
  currentBaseUrl: string;
  models: HermesModelDescriptor[];
  providers: HermesProviderListing[];
  note?: string;
};

export type HermesReasoningState = {
  effort: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';
  display: boolean;
};

export type HermesFastModeState = {
  enabled: boolean;
  supported: boolean;
};


export abstract class HermesCommandMethods {
  declare sessionStore: HermesBridgeSessionStore;
  declare modelStateCache: { value: HermesModelState; expiresAt: number } | null;
  declare contextWindowCache: Map<string, number | null>;
  declare runHermesPython: <T>(script: string, stdinPayload?: unknown) => T;
  declare broadcastEvent: (event: string, payload: unknown) => void;
  declare sendAgentLifecycleStart: (runId: string, sessionKey: string) => void;
  declare sendChatError: (runId: string, sessionKey: string, message: string) => void;
  declare updateSnapshot: (patch: { sessionCount?: number }) => void;
  declare log: (line: string) => void;


  executeModelCommand(rawCommand: string): string {
    const normalizedCommand = canonicalizeHermesModelCommand(
      rawCommand,
      this.readHermesModelState({ caller: 'model.command' }).providers,
    );
    const rawArgs = normalizedCommand.replace(/^\/model\b/i, '').trim();
    if (!rawArgs) {
      const state = this.readHermesModelState({ caller: 'model.command' });
      return formatHermesModelSummary(state);
    }

    const switchPayload = this.runHermesPython<{
      ok?: boolean;
      error?: string;
      result?: {
        new_model?: string;
        target_provider?: string;
        provider_label?: string;
      };
      state?: HermesModelState;
    }>(
      [
        'import inspect, json, re, sys',
        'from hermes_cli.config import load_config, save_config',
        'from hermes_cli.model_switch import switch_model, parse_model_flags, list_authenticated_providers',
        'from hermes_cli.auth import _load_auth_store',
        'from hermes_cli.models import OPENROUTER_MODELS, _PROVIDER_MODELS, provider_model_ids',
        'def build_provider_listing(cfg, current_provider, max_models=50):',
        '  provider_kwargs = {"current_provider": current_provider, "user_providers": cfg.get("providers"), "custom_providers": cfg.get("custom_providers"), "max_models": max_models}',
        '  try:',
        '    provider_params = inspect.signature(list_authenticated_providers).parameters',
        '    if not any(param.kind == inspect.Parameter.VAR_KEYWORD for param in provider_params.values()):',
        '      provider_kwargs = {key: value for key, value in provider_kwargs.items() if key in provider_params}',
        '  except Exception:',
        '    provider_kwargs.pop("custom_providers", None)',
        '  providers = list_authenticated_providers(**provider_kwargs)',
        '  seen = set()',
        '  for provider in providers:',
        '    slug = str(provider.get("slug") or "").strip()',
        '    if not slug:',
        '      continue',
        '    seen.add(slug)',
        '    if slug == "openai-codex":',
        '      try:',
        '        live_models = list(provider_model_ids(slug) or [])',
        '      except Exception:',
        '        live_models = []',
        '      if live_models:',
        '        provider["models"] = live_models[:max_models]',
        '        provider["total_models"] = len(live_models)',
        '  try:',
        '    store = _load_auth_store() or {}',
        '  except Exception:',
        '    store = {}',
        '  credential_pool = store.get("credential_pool") if isinstance(store, dict) else {}',
        '  if not isinstance(credential_pool, dict):',
        '    credential_pool = {}',
        '  provider_names = {"openrouter": "OpenRouter", "anthropic": "Anthropic", "openai": "OpenAI"}',
        '  for slug, entries in credential_pool.items():',
        '    if slug in seen or not isinstance(entries, list) or len(entries) == 0:',
        '      continue',
        '    if slug == "openrouter":',
        '      curated = [mid for mid, _ in OPENROUTER_MODELS]',
        '    else:',
        '      try:',
        '        curated = list(provider_model_ids(slug) or [])',
        '      except Exception:',
        '        curated = []',
        '      if not curated:',
        '        curated = list(_PROVIDER_MODELS.get(slug, []))',
        '    providers.append({',
        '      "slug": slug,',
        '      "name": provider_names.get(slug) or slug.replace("-", " ").title(),',
        '      "is_current": slug == current_provider,',
        '      "is_user_defined": False,',
        '      "models": curated[:max_models],',
        '      "total_models": len(curated),',
        '      "source": "credential-pool",',
        '    })',
        '    seen.add(slug)',
        '  custom_providers = cfg.get("custom_providers") if isinstance(cfg.get("custom_providers"), list) else []',
        '  for entry in custom_providers:',
        '    if not isinstance(entry, dict):',
        '      continue',
        '    display_name = str(entry.get("name") or "").strip()',
        '    api_url = (str(entry.get("base_url") or entry.get("url") or entry.get("api") or "")).strip()',
        '    if not display_name or not api_url:',
        '      continue',
        '    slug = "custom:" + display_name.lower().replace(" ", "-")',
        '    default_model = str(entry.get("model") or entry.get("default_model") or "").strip()',
        '    existing = next((provider for provider in providers if str(provider.get("slug") or "").strip() == slug), None)',
        '    if existing is not None:',
        '      if default_model:',
        '        models = existing.get("models") if isinstance(existing.get("models"), list) else []',
        '        if default_model not in models:',
        '          models = [default_model, *models][:max_models]',
        '        existing["models"] = models',
        '        existing["total_models"] = max(int(existing.get("total_models") or 0), 1)',
        '      if not existing.get("api_url"):',
        '        existing["api_url"] = api_url',
        '      continue',
        '    providers.append({',
        '      "slug": slug,',
        '      "name": display_name,',
        '      "is_current": slug == current_provider,',
        '      "is_user_defined": True,',
        '      "models": [default_model] if default_model else [],',
        '      "total_models": 1 if default_model else 0,',
        '      "source": "user-config",',
        '      "api_url": api_url,',
        '    })',
        '    seen.add(slug)',
        '  providers.sort(key=lambda provider: (not provider.get("is_current"), -int(provider.get("total_models") or 0), str(provider.get("name") or provider.get("slug") or "")))',
        '  return providers',
        'def build_model_entries(providers, current_model, current_provider):',
        '  models = []',
        '  seen = set()',
        '  for provider in providers:',
        '    slug = str(provider.get("slug") or "").strip()',
        '    for model in provider.get("models") or []:',
        '      ref = f"{slug}/{model}" if slug and model else model',
        '      if not ref or ref in seen:',
        '        continue',
        '      seen.add(ref)',
        '      models.append({"id": str(model), "name": str(model), "provider": slug})',
        '  current_ref = f"{current_provider}/{current_model}" if current_provider and current_model else current_model',
        '  if current_ref and current_ref not in seen:',
        '    models.insert(0, {"id": str(current_model), "name": str(current_model), "provider": str(current_provider)})',
        '  return models',
        'payload = json.loads(sys.stdin.read() or "{}")',
        'cfg = load_config() or {}',
        'model_cfg = cfg.get("model", {})',
        'current_model = model_cfg.get("default", "") if isinstance(model_cfg, dict) else ""',
        'current_provider = model_cfg.get("provider", "openrouter") if isinstance(model_cfg, dict) else "openrouter"',
        'current_base_url = model_cfg.get("base_url", "") if isinstance(model_cfg, dict) else ""',
        'model_input, explicit_provider, persist_global = parse_model_flags(payload.get("raw_args", ""))',
        'user_providers = dict(cfg.get("providers") or {}) if isinstance(cfg.get("providers"), dict) else {}',
        'for custom_provider in cfg.get("custom_providers") or []:',
        '  if not isinstance(custom_provider, dict):',
        '    continue',
        '  custom_name = str(custom_provider.get("name") or "").strip()',
        '  custom_slug = "custom:" + re.sub(r"[^a-z0-9]+", "-", custom_name.lower()).strip("-")',
        '  if custom_name and custom_slug != "custom:":',
        '    user_providers.setdefault(custom_slug, custom_provider)',
        'switch_kwargs = {',
        '  "raw_input": model_input,',
        '  "current_provider": current_provider,',
        '  "current_model": current_model,',
        '  "current_base_url": current_base_url,',
        '  "current_api_key": "",',
        '  "is_global": True,',
        '  "explicit_provider": explicit_provider,',
        '  "user_providers": user_providers,',
        '  "custom_providers": cfg.get("custom_providers"),',
        '}',
        'try:',
        '  switch_params = inspect.signature(switch_model).parameters',
        '  if not any(param.kind == inspect.Parameter.VAR_KEYWORD for param in switch_params.values()):',
        '    switch_kwargs = {key: value for key, value in switch_kwargs.items() if key in switch_params and switch_params[key].kind != inspect.Parameter.POSITIONAL_ONLY}',
        'except Exception:',
        '  switch_kwargs.pop("custom_providers", None)',
        'result = switch_model(**switch_kwargs)',
        'if not result.success:',
        '  print(json.dumps({"ok": False, "error": result.error_message}))',
        '  raise SystemExit(0)',
        'model_cfg = cfg.setdefault("model", {})',
        'model_cfg["default"] = result.new_model',
        'model_cfg["provider"] = result.target_provider',
        'if result.base_url:',
        '  model_cfg["base_url"] = result.base_url',
        'save_config(cfg)',
        'providers = build_provider_listing(cfg, result.target_provider, max_models=50)',
        'models = build_model_entries(providers, result.new_model, result.target_provider)',
        'state = {',
        '  "currentModel": result.new_model,',
        '  "currentProvider": result.target_provider,',
        '  "currentBaseUrl": result.base_url or "",',
        '  "providers": providers,',
        '  "models": models,',
        '}',
        'print(json.dumps({"ok": True, "result": {',
        '  "new_model": result.new_model,',
        '  "target_provider": result.target_provider,',
        '  "provider_label": result.provider_label,',
        '}, "state": state}))',
      ].join('\n'),
      { raw_args: rawArgs },
    );

    if (!switchPayload.ok) {
      throw new Error(readString(switchPayload.error) || 'Failed to switch Hermes model.');
    }

    const state = isRecord(switchPayload.state) ? normalizeHermesModelState(switchPayload.state) : null;
    const nextModel = readString(switchPayload.result?.new_model);
    const nextProvider = readString(switchPayload.result?.provider_label)
      || readString(switchPayload.result?.target_provider);

    return [
      `Model switched to ${nextModel || 'unknown'}.`,
      nextProvider ? `Provider: ${nextProvider}` : null,
      'Scope: global (future Hermes runs will use this model).',
      state ? `Current default: ${formatHermesCurrentModel(state)}` : null,
    ].filter(Boolean).join('\n');
  }

  readHermesModelState(options: { forceRefresh?: boolean; caller?: string } = {}): HermesModelState {
    if (!options.forceRefresh && this.modelStateCache && this.modelStateCache.expiresAt > Date.now()) {
      return this.modelStateCache.value;
    }

    const startedAt = Date.now();
    const payload = this.runHermesPython<unknown>(
      [
        'import inspect, json',
        'import time',
        'from hermes_cli.config import load_config',
        'from hermes_cli.model_switch import list_authenticated_providers',
        'from hermes_cli.auth import _load_auth_store',
        'from hermes_cli.models import OPENROUTER_MODELS, _PROVIDER_MODELS, provider_model_ids',
        'def build_provider_listing(cfg, current_provider, max_models=50):',
        '  provider_kwargs = {"current_provider": current_provider, "user_providers": cfg.get("providers"), "custom_providers": cfg.get("custom_providers"), "max_models": max_models}',
        '  try:',
        '    provider_params = inspect.signature(list_authenticated_providers).parameters',
        '    if not any(param.kind == inspect.Parameter.VAR_KEYWORD for param in provider_params.values()):',
        '      provider_kwargs = {key: value for key, value in provider_kwargs.items() if key in provider_params}',
        '  except Exception:',
        '    provider_kwargs.pop("custom_providers", None)',
        '  providers = list_authenticated_providers(**provider_kwargs)',
        '  seen = set()',
        '  for provider in providers:',
        '    slug = str(provider.get("slug") or "").strip()',
        '    if not slug:',
        '      continue',
        '    seen.add(slug)',
        '    if slug == "openai-codex":',
        '      try:',
        '        live_models = list(provider_model_ids(slug) or [])',
        '      except Exception:',
        '        live_models = []',
        '      if live_models:',
        '        provider["models"] = live_models[:max_models]',
        '        provider["total_models"] = len(live_models)',
        '  try:',
        '    store = _load_auth_store() or {}',
        '  except Exception:',
        '    store = {}',
        '  credential_pool = store.get("credential_pool") if isinstance(store, dict) else {}',
        '  if not isinstance(credential_pool, dict):',
        '    credential_pool = {}',
        '  provider_names = {"openrouter": "OpenRouter", "anthropic": "Anthropic", "openai": "OpenAI"}',
        '  for slug, entries in credential_pool.items():',
        '    if slug in seen or not isinstance(entries, list) or len(entries) == 0:',
        '      continue',
        '    if slug == "openrouter":',
        '      curated = [mid for mid, _ in OPENROUTER_MODELS]',
        '    else:',
        '      try:',
        '        curated = list(provider_model_ids(slug) or [])',
        '      except Exception:',
        '        curated = []',
        '      if not curated:',
        '        curated = list(_PROVIDER_MODELS.get(slug, []))',
        '    providers.append({',
        '      "slug": slug,',
        '      "name": provider_names.get(slug) or slug.replace("-", " ").title(),',
        '      "is_current": slug == current_provider,',
        '      "is_user_defined": False,',
        '      "models": curated[:max_models],',
        '      "total_models": len(curated),',
        '      "source": "credential-pool",',
        '    })',
        '    seen.add(slug)',
        '  custom_providers = cfg.get("custom_providers") if isinstance(cfg.get("custom_providers"), list) else []',
        '  for entry in custom_providers:',
        '    if not isinstance(entry, dict):',
        '      continue',
        '    display_name = str(entry.get("name") or "").strip()',
        '    api_url = (str(entry.get("base_url") or entry.get("url") or entry.get("api") or "")).strip()',
        '    if not display_name or not api_url:',
        '      continue',
        '    slug = "custom:" + display_name.lower().replace(" ", "-")',
        '    default_model = str(entry.get("model") or entry.get("default_model") or "").strip()',
        '    existing = next((provider for provider in providers if str(provider.get("slug") or "").strip() == slug), None)',
        '    if existing is not None:',
        '      if default_model:',
        '        models = existing.get("models") if isinstance(existing.get("models"), list) else []',
        '        if default_model not in models:',
        '          models = [default_model, *models][:max_models]',
        '        existing["models"] = models',
        '        existing["total_models"] = max(int(existing.get("total_models") or 0), 1)',
        '      if not existing.get("api_url"):',
        '        existing["api_url"] = api_url',
        '      continue',
        '    providers.append({',
        '      "slug": slug,',
        '      "name": display_name,',
        '      "is_current": slug == current_provider,',
        '      "is_user_defined": True,',
        '      "models": [default_model] if default_model else [],',
        '      "total_models": 1 if default_model else 0,',
        '      "source": "user-config",',
        '      "api_url": api_url,',
        '    })',
        '    seen.add(slug)',
        '  providers.sort(key=lambda provider: (not provider.get("is_current"), -int(provider.get("total_models") or 0), str(provider.get("name") or provider.get("slug") or "")))',
        '  return providers',
        'def build_model_entries(providers, current_model, current_provider):',
        '  models = []',
        '  seen = set()',
        '  for provider in providers:',
        '    slug = str(provider.get("slug") or "").strip()',
        '    for model in provider.get("models") or []:',
        '      ref = f"{slug}/{model}" if slug and model else model',
        '      if not ref or ref in seen:',
        '        continue',
        '      seen.add(ref)',
        '      models.append({"id": str(model), "name": str(model), "provider": slug})',
        '  current_ref = f"{current_provider}/{current_model}" if current_provider and current_model else current_model',
        '  if current_ref and current_ref not in seen:',
        '    models.insert(0, {"id": str(current_model), "name": str(current_model), "provider": str(current_provider)})',
        '  return models',
        'total_started = time.perf_counter()',
        'load_started = time.perf_counter()',
        'cfg = load_config() or {}',
        'load_finished = time.perf_counter()',
        'model_cfg = cfg.get("model", {})',
        'current_model = model_cfg.get("default", "") if isinstance(model_cfg, dict) else ""',
        'current_provider = model_cfg.get("provider", "openrouter") if isinstance(model_cfg, dict) else "openrouter"',
        'current_base_url = model_cfg.get("base_url", "") if isinstance(model_cfg, dict) else ""',
        'providers_started = time.perf_counter()',
        'providers = build_provider_listing(cfg, current_provider, max_models=50)',
        'providers_finished = time.perf_counter()',
        'models_started = time.perf_counter()',
        'models = build_model_entries(providers, current_model, current_provider)',
        'models_finished = time.perf_counter()',
        'print(json.dumps({',
        '  "currentModel": current_model,',
        '  "currentProvider": current_provider,',
        '  "currentBaseUrl": current_base_url,',
        '  "providers": providers,',
        '  "models": models,',
        '  "_debugTimings": {',
        '    "loadConfigMs": round((load_finished - load_started) * 1000, 2),',
        '    "buildProvidersMs": round((providers_finished - providers_started) * 1000, 2),',
        '    "buildModelsMs": round((models_finished - models_started) * 1000, 2),',
        '    "totalMs": round((models_finished - total_started) * 1000, 2),',
        '  },',
        '  "_debugProviderCount": len(providers),',
        '  "_debugModelCount": len(models),',
        '}))',
      ].join('\n'),
    );
    const payloadRecord = isRecord(payload) ? payload : {};
    const debugTimings = isRecord(payloadRecord._debugTimings) ? payloadRecord._debugTimings : null;
    const totalMs = Number(debugTimings?.totalMs);
    if (Number.isFinite(totalMs) && totalMs >= SLOW_BRIDGE_REQUEST_LOG_THRESHOLD_MS) {
      const loadConfigMs = Number(debugTimings?.loadConfigMs);
      const buildProvidersMs = Number(debugTimings?.buildProvidersMs);
      const buildModelsMs = Number(debugTimings?.buildModelsMs);
      const providerCount = Number(payloadRecord._debugProviderCount);
      const modelCount = Number(payloadRecord._debugModelCount);
      this.log(
        'slow model state refresh '
          + `caller=${options.caller ?? 'unknown'} `
          + `cache=${options.forceRefresh ? 'force' : 'miss'} `
          + `elapsedMs=${Date.now() - startedAt} `
          + `pythonTotalMs=${totalMs} `
          + `loadConfigMs=${Number.isFinite(loadConfigMs) ? loadConfigMs : 'n/a'} `
          + `buildProvidersMs=${Number.isFinite(buildProvidersMs) ? buildProvidersMs : 'n/a'} `
          + `buildModelsMs=${Number.isFinite(buildModelsMs) ? buildModelsMs : 'n/a'} `
          + `providers=${Number.isFinite(providerCount) ? providerCount : 'n/a'} `
          + `models=${Number.isFinite(modelCount) ? modelCount : 'n/a'}`,
      );
    }
    const state = normalizeHermesModelState(payload);
    this.modelStateCache = {
      value: state,
      expiresAt: Date.now() + HERMES_MODEL_STATE_CACHE_TTL_MS,
    };
    return state;
  }

  resolveHermesContextWindow(input: {
    model?: string;
    provider?: string;
    baseUrl?: string;
  }): number | undefined {
    const model = input.model?.trim() || '';
    if (!model) return undefined;
    const provider = input.provider?.trim() || '';
    const baseUrl = input.baseUrl?.trim() || '';
    const cacheKey = `${provider}\u0000${baseUrl}\u0000${model}`;
    if (this.contextWindowCache.has(cacheKey)) {
      const cached = this.contextWindowCache.get(cacheKey);
      return typeof cached === 'number' ? cached : undefined;
    }

    try {
      const result = this.runHermesPython<{ contextTokens?: number | null }>(
        [
          'import json',
          'from agent.model_metadata import get_model_context_length',
          'payload = json.loads(input() or "{}")',
          'model = str(payload.get("model") or "").strip()',
          'provider = str(payload.get("provider") or "").strip()',
          'base_url = str(payload.get("baseUrl") or "").strip()',
          'if not model:',
          '  print(json.dumps({"contextTokens": None}))',
          '  raise SystemExit(0)',
          'context_tokens = None',
          'try:',
          '  context_tokens = int(get_model_context_length(',
          '    model,',
          '    base_url=base_url,',
          '    api_key="",',
          '    provider=provider,',
          '  ))',
          'except Exception:',
          '  context_tokens = None',
          'print(json.dumps({"contextTokens": context_tokens}))',
        ].join('\n'),
        { model, provider, baseUrl },
      );
      const contextTokens = typeof result?.contextTokens === 'number'
        && Number.isFinite(result.contextTokens)
        && result.contextTokens > 0
        ? result.contextTokens
        : null;
      this.contextWindowCache.set(cacheKey, contextTokens);
      return contextTokens ?? undefined;
    } catch {
      this.contextWindowCache.set(cacheKey, null);
      return undefined;
    }
  }

  readHermesCurrentModelState(): HermesCurrentModelState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'from hermes_cli.config import load_config',
        'cfg = load_config() or {}',
        'model_cfg = cfg.get("model", {})',
        'current_model = model_cfg.get("default", "") if isinstance(model_cfg, dict) else ""',
        'current_provider = model_cfg.get("provider", "openrouter") if isinstance(model_cfg, dict) else "openrouter"',
        'current_base_url = model_cfg.get("base_url", "") if isinstance(model_cfg, dict) else ""',
        'print(json.dumps({',
        '  "currentModel": current_model,',
        '  "currentProvider": current_provider,',
        '  "currentBaseUrl": current_base_url,',
        '  "note": None,',
        '}))',
      ].join('\n'),
    );

    const record = isRecord(payload) ? payload : {};
    return {
      currentModel: readString(record.currentModel) ?? '',
      currentProvider: readString(record.currentProvider) ?? '',
      currentBaseUrl: readString(record.currentBaseUrl) ?? '',
      note: readString(record.note) ?? null,
    };
  }

  setHermesModel(payload: Record<string, unknown>): HermesModelSetResult {
    const scope = readString(payload.scope) || 'global';
    if (scope !== 'global') {
      throw new Error('Hermes bridge supports global model switching only.');
    }

    const state = this.readHermesModelState({ caller: 'model.set' });
    const providerInput = readString(payload.provider);
    const provider = providerInput
      ? canonicalizeHermesProviderSlug(providerInput, state.providers)
      : '';
    const rawModel = readString(payload.model)
      || readString(payload.modelRef)
      || readString(payload.id);
    if (!rawModel) {
      throw new Error('model.set requires a model.');
    }
    const model = rawModel.trim();

    const command = provider
      ? `/model ${model} --provider ${provider} --global`
      : `/model ${model} --global`;
    this.executeModelCommand(command);
    const nextState = this.readHermesModelState({ forceRefresh: true, caller: 'model.set' });

    return {
      ok: true,
      scope: 'global',
      currentModel: nextState.currentModel,
      currentProvider: nextState.currentProvider,
      currentBaseUrl: nextState.currentBaseUrl,
      models: nextState.models,
      providers: nextState.providers,
      note: 'Hermes model changes apply globally to future runs.',
    };
  }

  getHermesThinkingLevel(): string {
    const state = this.readHermesReasoningState();
    return state.effort === 'none' ? 'off' : state.effort;
  }

  getHermesReasoningPayload(): {
    level: string;
    rawLevel: string;
    showReasoning: boolean;
  } {
    const state = this.readHermesReasoningState();
    return {
      level: this.getHermesThinkingLevel(),
      rawLevel: state.effort,
      showReasoning: state.display,
    };
  }

  setHermesReasoningPayload(payload: Record<string, unknown>): {
    level: string;
    rawLevel: string;
    showReasoning: boolean;
  } {
    const requestedLevel = normalizeThinkingLevelAlias(
      readString(payload.level)
      || readString(payload.thinkingLevel)
      || '',
    );
    const requestedShowReasoning = readBoolean(payload.showReasoning);
    if (!requestedLevel && requestedShowReasoning == null) {
      throw new Error('hermes.reasoning.set requires a level or showReasoning value.');
    }

    const current = this.readHermesReasoningState();
    const nextEffort: HermesReasoningState['effort'] = requestedLevel
      ? (requestedLevel === 'off' ? 'none' : requestedLevel as HermesReasoningState['effort'])
      : current.effort;
    const next = this.setHermesReasoningState({
      effort: nextEffort,
      display: requestedShowReasoning ?? current.display,
    });
    return {
      level: next.effort === 'none' ? 'off' : next.effort,
      rawLevel: next.effort,
      showReasoning: next.display,
    };
  }

  readHermesReasoningState(): HermesReasoningState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'from hermes_cli.config import load_config',
        'from hermes_constants import parse_reasoning_effort',
        'cfg = load_config() or {}',
        'agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}',
        'display_cfg = cfg.get("display") if isinstance(cfg.get("display"), dict) else {}',
        'raw_effort = str(agent_cfg.get("reasoning_effort") or "").strip()',
        'parsed = parse_reasoning_effort(raw_effort)',
        'if parsed is None:',
        '  effort = "medium"',
        'elif parsed.get("enabled") is False:',
        '  effort = "none"',
        'else:',
        '  effort = str(parsed.get("effort") or "medium").strip().lower() or "medium"',
        'display = bool(display_cfg.get("show_reasoning", False))',
        'print(json.dumps({',
        '  "effort": effort,',
        '  "display": display,',
        '}))',
      ].join('\n'),
    );
    const record = isRecord(payload) ? payload : {};
    const effort = readString(record.effort).toLowerCase();
    return {
      effort: isHermesReasoningEffort(effort) ? effort : 'medium',
      display: record.display === true,
    };
  }

  setHermesReasoningState(next: HermesReasoningState): HermesReasoningState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'import os',
        'from pathlib import Path',
        'from hermes_cli.config import load_config',
        'from utils import atomic_yaml_write',
        'payload = json.loads(input() or "{}")',
        'cfg = load_config() or {}',
        'agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}',
        'display_cfg = cfg.get("display") if isinstance(cfg.get("display"), dict) else {}',
        'effort = str(payload.get("effort") or "medium").strip().lower()',
        'display = bool(payload.get("display", False))',
        'agent_cfg["reasoning_effort"] = "" if effort == "medium" else ("none" if effort == "none" else effort)',
        'display_cfg["show_reasoning"] = display',
        'cfg["agent"] = agent_cfg',
        'cfg["display"] = display_cfg',
        'config_root = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))',
        'config_path = config_root / "config.yaml"',
        'atomic_yaml_write(config_path, cfg)',
        'print(json.dumps({',
        '  "effort": effort,',
        '  "display": display,',
        '}))',
      ].join('\n'),
      next,
    );
    const record = isRecord(payload) ? payload : {};
    const effort = readString(record.effort).toLowerCase();
    return {
      effort: isHermesReasoningEffort(effort) ? effort : next.effort,
      display: record.display === true,
    };
  }

  readHermesFastModeState(): HermesFastModeState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'from hermes_cli.config import load_config',
        'from hermes_cli.models import model_supports_fast_mode',
        'cfg = load_config() or {}',
        'agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}',
        'model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}',
        'current_model = str(model_cfg.get("default") or model_cfg.get("model") or "").strip()',
        'service_tier = str(agent_cfg.get("service_tier") or "").strip().lower()',
        'supported = bool(current_model) and bool(model_supports_fast_mode(current_model))',
        'enabled = service_tier == "fast" or service_tier == "priority"',
        'print(json.dumps({',
        '  "enabled": enabled,',
        '  "supported": supported,',
        '}))',
      ].join('\n'),
    );
    const record = isRecord(payload) ? payload : {};
    return {
      enabled: record.enabled === true,
      supported: record.supported === true,
    };
  }

  setHermesFastModeState(enabled: boolean): HermesFastModeState {
    const payload = this.runHermesPython<unknown>(
      [
        'import json',
        'import os',
        'from pathlib import Path',
        'from hermes_cli.config import load_config',
        'from hermes_cli.models import model_supports_fast_mode',
        'from utils import atomic_yaml_write',
        'payload = json.loads(input() or "{}")',
        'cfg = load_config() or {}',
        'agent_cfg = cfg.get("agent") if isinstance(cfg.get("agent"), dict) else {}',
        'model_cfg = cfg.get("model") if isinstance(cfg.get("model"), dict) else {}',
        'current_model = str(model_cfg.get("default") or model_cfg.get("model") or "").strip()',
        'supported = bool(current_model) and bool(model_supports_fast_mode(current_model))',
        'enabled = bool(payload.get("enabled", False))',
        'if not supported:',
        '  print(json.dumps({',
        '    "enabled": False,',
        '    "supported": False,',
        '  }))',
        '  raise SystemExit(0)',
        'agent_cfg["service_tier"] = "fast" if enabled else "normal"',
        'cfg["agent"] = agent_cfg',
        'config_root = Path(os.environ.get("HERMES_HOME") or (Path.home() / ".hermes"))',
        'config_path = config_root / "config.yaml"',
        'atomic_yaml_write(config_path, cfg)',
        'print(json.dumps({',
        '  "enabled": enabled,',
        '  "supported": True,',
        '}))',
      ].join('\n'),
      { enabled },
    );
    const record = isRecord(payload) ? payload : {};
    return {
      enabled: record.enabled === true,
      supported: record.supported === true,
    };
  }

  getHermesFastModePayload(): HermesFastModeState {
    return this.readHermesFastModeState();
  }

  setHermesFastModePayload(payload: Record<string, unknown>): HermesFastModeState {
    const enabled = readBoolean(payload.enabled);
    if (enabled == null) {
      throw new Error('hermes.fast.set requires an enabled boolean.');
    }
    return this.setHermesFastModeState(enabled);
  }

  executeReasoningCommand(rawCommand: string): string {
    const normalizedCommand = rawCommand.trim();
    const rawArgs = normalizedCommand.replace(/^\/reasoning\b/i, '').trim();
    const currentState = this.readHermesReasoningState();
    if (!rawArgs) {
      return formatHermesReasoningSummary(currentState);
    }

    const arg = normalizeThinkingLevelAlias(rawArgs);
    if (arg === 'show' || arg === 'on') {
      const nextState = this.setHermesReasoningState({
        effort: currentState.effort,
        display: true,
      });
      return [
        'Reasoning display turned on.',
        '',
        formatHermesReasoningSummary(nextState),
      ].join('\n');
    }
    if (arg === 'hide' || arg === 'off-display') {
      const nextState = this.setHermesReasoningState({
        effort: currentState.effort,
        display: false,
      });
      return [
        'Reasoning display turned off.',
        '',
        formatHermesReasoningSummary(nextState),
      ].join('\n');
    }
    if (!isHermesReasoningEffort(arg)) {
      throw new Error('Valid reasoning levels: none, minimal, low, medium, high, xhigh, show, hide.');
    }
    const nextState = this.setHermesReasoningState({
      effort: arg,
      display: currentState.display,
    });
    return [
      `Reasoning effort set to ${formatHermesReasoningEffortLabel(nextState.effort)}.`,
      '',
      formatHermesReasoningSummary(nextState),
    ].join('\n');
  }

  executeThinkingCommand(rawCommand: string): string {
    const normalizedCommand = rawCommand.trim();
    const rawArgs = normalizedCommand.replace(/^\/think\b/i, '').trim();
    const currentState = this.readHermesReasoningState();
    if (!rawArgs) {
      return formatHermesThinkingSummary(currentState);
    }
    const normalizedLevel = normalizeThinkingLevelAlias(rawArgs);
    if (!isHermesReasoningEffort(normalizedLevel)) {
      throw new Error('Valid thinking levels: off, minimal, low, medium, high, xhigh.');
    }
    const nextState = this.setHermesReasoningState({
      effort: normalizedLevel,
      display: currentState.display,
    });
    return [
      `Thinking level set to ${formatHermesThinkingLevelLabel(nextState.effort)}.`,
      '',
      formatHermesThinkingSummary(nextState),
    ].join('\n');
  }

  executeFastCommand(rawCommand: string): string {
    const normalizedCommand = rawCommand.trim().replace(/:$/, '');
    const rawArgs = normalizedCommand.replace(/^\/fast\b/i, '').trim().toLowerCase();
    const currentState = this.readHermesFastModeState();
    if (!currentState.supported) {
      throw new Error('Fast mode is only available for models that support it.');
    }
    if (!rawArgs || rawArgs === 'status') {
      return formatHermesFastModeSummary(currentState);
    }
    if (!isHermesFastModeValue(rawArgs)) {
      throw new Error('Valid fast mode values: on, off, fast, normal, status.');
    }
    const nextState = this.setHermesFastModeState(rawArgs === 'on' || rawArgs === 'fast');
    return [
      `Fast mode turned ${nextState.enabled ? 'on' : 'off'}.`,
      '',
      formatHermesFastModeSummary(nextState),
    ].join('\n');
  }
}

function isModelCommand(text: string): boolean {
  return /^\/model(?:\s|$)/i.test(text.trim());
}

function isThinkingCommand(text: string): boolean {
  return /^\/think(?:\s|$)/i.test(text.trim());
}

function isReasoningCommand(text: string): boolean {
  return /^\/reasoning(?:\s|$)/i.test(text.trim());
}

function isFastCommand(text: string): boolean {
  return /^\/fast(?::|\s|$)/i.test(text.trim());
}

function normalizeHermesProviderListing(value: unknown): HermesProviderListing | null {
  if (!isRecord(value)) return null;
  const slug = readString(value.slug);
  const name = readString(value.name) || slug;
  if (!slug || !name) return null;
  const rawModels = Array.isArray(value.models) ? value.models : [];
  const models = rawModels
    .map((entry) => readString(entry))
    .filter(Boolean);
  return {
    slug,
    name,
    isCurrent: value.is_current === true || value.isCurrent === true,
    models,
    totalModels: readNumber(value.total_models ?? value.totalModels) ?? models.length,
    source: readString(value.source) || undefined,
    apiUrl: readString(value.api_url ?? value.apiUrl) || undefined,
  };
}

function normalizeHermesProviderAlias(value: string): string {
  return value.trim().toLowerCase();
}

function canonicalizeHermesModelCommand(
  rawCommand: string,
  providers: HermesProviderListing[],
): string {
  const trimmed = rawCommand.trim();
  if (!trimmed) {
    return rawCommand;
  }

  const commandBody = trimmed.replace(/^\/model\b/i, '').trim();
  if (!commandBody || !commandBody.includes('--provider')) {
    return trimmed;
  }

  const tokens = commandBody.split(/\s+/);
  const rewritten: string[] = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--provider' && index + 1 < tokens.length) {
      rewritten.push(token, canonicalizeHermesProviderSlug(tokens[index + 1] ?? '', providers));
      index += 1;
      continue;
    }
    rewritten.push(token);
  }

  return `/model ${rewritten.join(' ').trim()}`.trim();
}

function canonicalizeHermesProviderSlug(
  provider: string,
  providers: HermesProviderListing[],
): string {
  const normalized = normalizeHermesProviderAlias(provider);
  if (!normalized) {
    return '';
  }

  for (const entry of providers) {
    if (normalizeHermesProviderAlias(entry.slug) === normalized) {
      return entry.slug;
    }
  }

  for (const entry of providers) {
    const aliases = new Set([
      normalizeHermesProviderAlias(entry.name),
      normalizeHermesProviderAlias(entry.name.replace(/\s+/g, '-')),
    ]);
    if (entry.slug.startsWith('custom:')) {
      aliases.add(normalizeHermesProviderAlias(entry.slug.slice('custom:'.length)));
    }
    if (aliases.has(normalized)) {
      return entry.slug;
    }
  }

  const prefixedCustom = normalized.startsWith('custom:')
    ? normalized
    : `custom:${normalized}`;
  const customMatch = providers.find(
    (entry) => normalizeHermesProviderAlias(entry.slug) === prefixedCustom,
  );
  if (customMatch) {
    return customMatch.slug;
  }

  return provider;
}

function normalizeHermesModelDescriptor(value: unknown): HermesModelDescriptor | null {
  if (!isRecord(value)) return null;
  const id = readString(value.id);
  const provider = readString(value.provider);
  if (!id || !provider) return null;
  return {
    id,
    name: readString(value.name) || id,
    provider,
  };
}

function normalizeHermesModelState(value: unknown): HermesModelState {
  const record = isRecord(value) ? value : {};
  const providers = Array.isArray(record.providers)
    ? record.providers
      .map((entry) => normalizeHermesProviderListing(entry))
      .filter((entry): entry is HermesProviderListing => entry !== null)
    : [];
  const currentModel = readString(record.currentModel);
  const currentProvider = canonicalizeHermesProviderSlug(
    readString(record.currentProvider),
    providers,
  );
  const currentBaseUrl = readString(record.currentBaseUrl);
  const models = Array.isArray(record.models)
    ? record.models
      .map((entry) => normalizeHermesModelDescriptor(entry))
      .filter((entry): entry is HermesModelDescriptor => entry !== null)
      .map((entry) => ({
        ...entry,
        provider: canonicalizeHermesProviderSlug(entry.provider, providers),
      }))
    : [];

  const seenModels = new Set<string>();
  const dedupedModels: HermesModelDescriptor[] = [];
  for (const entry of models) {
    const key = `${entry.provider}::${entry.id}`;
    if (seenModels.has(key)) {
      continue;
    }
    seenModels.add(key);
    dedupedModels.push(entry);
  }

  if (currentModel && currentProvider) {
    const currentExists = dedupedModels.some((entry) => entry.id === currentModel && entry.provider === currentProvider);
    if (!currentExists) {
      dedupedModels.unshift({
        id: currentModel,
        name: currentModel,
        provider: currentProvider,
      });
    }
  }
  return {
    currentModel,
    currentProvider,
    currentBaseUrl,
    providers,
    models: dedupedModels,
  };
}

function formatHermesCurrentModel(state: HermesModelState): string {
  if (!state.currentModel) {
    return 'not configured';
  }
  return state.currentProvider
    ? `${state.currentProvider}/${state.currentModel}`
    : state.currentModel;
}

function formatHermesModelSummary(state: HermesModelState): string {
  const lines = [`Current: ${formatHermesCurrentModel(state)}`];
  if (state.providers.length > 0) {
    lines.push('');
    lines.push('Available providers:');
    for (const provider of state.providers.slice(0, 8)) {
      const models = provider.models.slice(0, 6).join(', ');
      const suffix = provider.totalModels > provider.models.length
        ? ` (+${provider.totalModels - provider.models.length} more)`
        : '';
      const currentTag = provider.isCurrent ? ' [current]' : '';
      lines.push(`- ${provider.name}${currentTag}: ${models || '(no curated models)'}${suffix}`);
    }
  }
  lines.push('');
  lines.push('Use /model <name> --provider <slug> to switch globally.');
  return lines.join('\n');
}

function normalizeThinkingLevelAlias(value: string): string {
  const normalized = value.trim().toLowerCase();
  if (normalized === 'off') return 'none';
  if (normalized === 'hide') return 'off-display';
  return normalized;
}

function isHermesReasoningEffort(value: string): value is HermesReasoningState['effort'] {
  return value === 'none'
    || value === 'minimal'
    || value === 'low'
    || value === 'medium'
    || value === 'high'
    || value === 'xhigh';
}

function formatHermesReasoningEffortLabel(value: HermesReasoningState['effort']): string {
  return value === 'none' ? 'off' : value;
}

function formatHermesThinkingLevelLabel(value: HermesReasoningState['effort']): string {
  return value === 'none' ? 'off' : value;
}

function formatHermesThinkingSummary(state: HermesReasoningState): string {
  return [
    `Current thinking level: ${formatHermesThinkingLevelLabel(state.effort)}`,
    'Options: off, minimal, low, medium, high, xhigh',
  ].join('\n');
}

function formatHermesReasoningSummary(state: HermesReasoningState): string {
  return [
    `Current reasoning level: ${formatHermesReasoningEffortLabel(state.effort)}`,
    'Options: none, minimal, low, medium, high, xhigh',
    `Reasoning display: ${state.display ? 'on' : 'off'}`,
  ].join('\n');
}

function isHermesFastModeValue(value: string): boolean {
  return value === 'on'
    || value === 'off'
    || value === 'fast'
    || value === 'normal'
    || value === 'status';
}

function formatHermesFastModeSummary(state: HermesFastModeState): string {
  return [
    `Current fast mode: ${state.enabled ? 'on' : 'off'}`,
    'Options: on, off',
  ].join('\n');
}
