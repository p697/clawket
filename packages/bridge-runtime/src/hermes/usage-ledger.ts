import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  DebouncedFilePersister,
  isRecord,
  readString,
} from './internal.js';

export type HermesUsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  totalTokens: number;
  totalCost: number;
  inputCost: number;
  outputCost: number;
  cacheReadCost: number;
  cacheWriteCost: number;
  missingCostEntries: number;
};

export type HermesUsageResult = {
  updatedAt?: number;
  startDate?: string;
  endDate?: string;
  sessions?: Array<{
    key: string;
    label?: string;
    agentId?: string;
    channel?: string;
    model?: string;
    modelProvider?: string;
    updatedAt?: number;
    usage: {
      totalTokens: number;
      totalCost: number;
      costStatus?: string;
      costSource?: string;
      messageCounts?: {
        total: number;
        user: number;
        assistant: number;
        toolCalls: number;
        toolResults: number;
        errors: number;
      };
    } | null;
  }>;
  totals?: HermesUsageTotals;
  aggregates?: {
    messages: {
      total: number;
      user: number;
      assistant: number;
      toolCalls: number;
      toolResults: number;
      errors: number;
    };
    tools: {
      totalCalls: number;
      uniqueTools: number;
      tools: Array<{ name: string; count: number }>;
    };
    byModel: Array<{
      provider?: string;
      model?: string;
      count: number;
      totals: HermesUsageTotals;
    }>;
    byProvider: Array<{
      provider?: string;
      model?: string;
      count: number;
      totals: HermesUsageTotals;
    }>;
    byAgent: Array<{ agentId: string; totals: HermesUsageTotals }>;
    byChannel: Array<{ channel: string; totals: HermesUsageTotals }>;
    daily: Array<{
      date: string;
      tokens: number;
      cost: number;
      messages: number;
      toolCalls: number;
      errors: number;
    }>;
  };
  costPresentation?: {
    mode: 'currency' | 'included' | 'estimated' | 'actual' | 'unknown' | 'mixed';
    relevantSessions?: number;
    includedSessions?: number;
    estimatedSessions?: number;
    actualSessions?: number;
    unknownSessions?: number;
  };
};

export type HermesCostSummary = {
  updatedAt?: number;
  days?: number;
  daily?: Array<HermesUsageTotals & { date: string }>;
  totals?: HermesUsageTotals;
  costPresentation?: HermesUsageResult['costPresentation'];
};

export type HermesUsageBundle = {
  usageResult: HermesUsageResult;
  costSummary: HermesCostSummary;
};

export type HermesObservedSessionUsageSnapshot = {
  sessionId: string;
  startedAtMs: number | null;
  endedAtMs: number | null;
  title: string | null;
  source: string | null;
  model: string | null;
  billingProvider: string | null;
  costStatus: string | null;
  costSource: string | null;
  totals: HermesUsageTotals;
};

export type HermesUsageLedgerSessionEntry = {
  key: string;
  label: string;
  agentId: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  costStatus?: string;
  costSource?: string;
  updatedAt: number;
  totals: HermesUsageTotals;
};

export type HermesUsageLedgerDayRecord = {
  date: string;
  sessions: Record<string, HermesUsageLedgerSessionEntry>;
};

export type HermesUsageLedgerSnapshotRecord = {
  sessionId: string;
  key: string;
  label: string;
  agentId: string;
  channel?: string;
  model?: string;
  modelProvider?: string;
  costStatus?: string;
  costSource?: string;
  updatedAt: number;
  startedAtMs?: number;
  totals: HermesUsageTotals;
};

export type HermesUsageLedgerPersistedState = {
  version: 1;
  snapshots: Record<string, HermesUsageLedgerSnapshotRecord>;
  days: Record<string, HermesUsageLedgerDayRecord>;
};


export abstract class HermesUsageMethods {
  declare hermesHomePath: string;
  declare options: { hermesStateDbPath?: string };
  declare usageLedger: HermesUsageLedgerStore;

  readHermesUsageBundle(payload: Record<string, unknown>): HermesUsageBundle {
    const startDate = readString(payload.startDate);
    const endDate = readString(payload.endDate);
    if (!startDate || !endDate) {
      throw new Error('Hermes usage queries require startDate and endDate.');
    }

    const stateDbPath = this.getHermesStateDbPath();
    if (!existsSync(stateDbPath)) {
      return {
        usageResult: {
          updatedAt: Date.now(),
          startDate,
          endDate,
          sessions: [],
          totals: createEmptyHermesUsageTotals(),
          aggregates: {
            messages: { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 },
            tools: { totalCalls: 0, uniqueTools: 0, tools: [] },
            byModel: [],
            byProvider: [],
            byAgent: [],
            byChannel: [],
            daily: [],
          },
        },
        costSummary: {
          updatedAt: Date.now(),
          days: countDateRangeDays(startDate, endDate),
          daily: [],
          totals: createEmptyHermesUsageTotals(),
        },
      };
    }

    const raw = execFileSync(
      'python3',
      [
        '-c',
        [
          'import json, pathlib, sqlite3, sys',
          'db_path, start_date, end_date = sys.argv[1], sys.argv[2], sys.argv[3]',
          'db_uri = pathlib.Path(db_path).resolve().as_uri() + "?mode=ro"',
          'conn = sqlite3.connect(db_uri, uri=True)',
          'conn.execute("PRAGMA query_only = ON")',
          'conn.row_factory = sqlite3.Row',
          'cur = conn.cursor()',
          'cur.execute("""',
          'SELECT id, source, model, title, started_at, ended_at,',
          '       message_count, tool_call_count,',
          '       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,',
          '       estimated_cost_usd, actual_cost_usd, cost_status, cost_source, billing_provider',
          'FROM sessions',
          'WHERE date(started_at, "unixepoch", "localtime") >= ?',
          '  AND date(started_at, "unixepoch", "localtime") <= ?',
          'ORDER BY started_at DESC',
          '""", (start_date, end_date))',
          'session_rows = [dict(row) for row in cur.fetchall()]',
          'session_ids = [row["id"] for row in session_rows]',
          'message_rows = []',
          'if session_ids:',
          '    placeholders = ",".join("?" for _ in session_ids)',
          '    cur.execute(f"""',
          '    SELECT m.session_id, m.role, m.content, m.tool_name, m.tool_calls, m.timestamp',
          '    FROM messages m',
          '    WHERE m.session_id IN ({placeholders})',
          '    ORDER BY m.timestamp, m.id',
          '    """, session_ids)',
          '    message_rows = [dict(row) for row in cur.fetchall()]',
          '',
          'def empty_totals():',
          '    return {',
          '        "input": 0, "output": 0, "cacheRead": 0, "cacheWrite": 0,',
          '        "totalTokens": 0, "totalCost": 0.0,',
          '        "inputCost": 0.0, "outputCost": 0.0,',
          '        "cacheReadCost": 0.0, "cacheWriteCost": 0.0,',
          '        "missingCostEntries": 0,',
          '    }',
          '',
          'def allocate_cost(row):',
          '    input_tokens = int(row.get("input_tokens") or 0)',
          '    output_tokens = int(row.get("output_tokens") or 0)',
          '    cache_read_tokens = int(row.get("cache_read_tokens") or 0)',
          '    cache_write_tokens = int(row.get("cache_write_tokens") or 0)',
          '    total_tokens = input_tokens + output_tokens + cache_read_tokens + cache_write_tokens',
          '    raw_cost = row.get("actual_cost_usd")',
          '    if raw_cost is None:',
          '        raw_cost = row.get("estimated_cost_usd")',
          '    total_cost = float(raw_cost or 0.0)',
          '    allocated = {',
          '        "inputCost": 0.0, "outputCost": 0.0,',
          '        "cacheReadCost": 0.0, "cacheWriteCost": 0.0,',
          '    }',
          '    if total_cost > 0 and total_tokens > 0:',
          '        allocated["inputCost"] = total_cost * (input_tokens / total_tokens)',
          '        allocated["outputCost"] = total_cost * (output_tokens / total_tokens)',
          '        allocated["cacheReadCost"] = total_cost * (cache_read_tokens / total_tokens)',
          '        allocated["cacheWriteCost"] = total_cost * (cache_write_tokens / total_tokens)',
          '    missing = 1 if total_tokens > 0 and total_cost <= 0 and str(row.get("cost_status") or "") not in ("included", "none") else 0',
          '    return total_cost, allocated, missing',
          '',
          'def add_totals(dst, row, total_cost, allocated, missing):',
          '    dst["input"] += int(row.get("input_tokens") or 0)',
          '    dst["output"] += int(row.get("output_tokens") or 0)',
          '    dst["cacheRead"] += int(row.get("cache_read_tokens") or 0)',
          '    dst["cacheWrite"] += int(row.get("cache_write_tokens") or 0)',
          '    dst["totalTokens"] += int(row.get("input_tokens") or 0) + int(row.get("output_tokens") or 0) + int(row.get("cache_read_tokens") or 0) + int(row.get("cache_write_tokens") or 0)',
          '    dst["totalCost"] += total_cost',
          '    dst["inputCost"] += allocated["inputCost"]',
          '    dst["outputCost"] += allocated["outputCost"]',
          '    dst["cacheReadCost"] += allocated["cacheReadCost"]',
          '    dst["cacheWriteCost"] += allocated["cacheWriteCost"]',
          '    dst["missingCostEntries"] += missing',
          '',
          'messages_by_session = {}',
          'tool_counts = {}',
          'message_totals = {"total": 0, "user": 0, "assistant": 0, "toolCalls": 0, "toolResults": 0, "errors": 0}',
          'daily = {}',
          '',
          'for row in message_rows:',
          '    session_id = row.get("session_id")',
          '    messages_by_session[session_id] = messages_by_session.get(session_id, {"total": 0, "user": 0, "assistant": 0, "toolResults": 0, "errors": 0})',
          '    role = str(row.get("role") or "")',
          '    ts = float(row.get("timestamp") or 0.0)',
          '    day = ""',
          '    if ts > 0:',
          '        cur.execute(\'SELECT date(?, "unixepoch", "localtime") AS d\', (ts,))',
          '        day = (cur.fetchone()["d"] or "")',
          '    if day and day not in daily:',
          '        daily[day] = {"date": day, "tokens": 0, "cost": 0.0, "messages": 0, "toolCalls": 0, "errors": 0}',
          '    if role in ("user", "assistant", "tool"):',
          '        message_totals["total"] += 1',
          '        messages_by_session[session_id]["total"] += 1',
          '        if day:',
          '            daily[day]["messages"] += 1',
          '    if role == "user":',
          '        message_totals["user"] += 1',
          '        messages_by_session[session_id]["user"] += 1',
          '    elif role == "assistant":',
          '        message_totals["assistant"] += 1',
          '        messages_by_session[session_id]["assistant"] += 1',
          '        try:',
          '            tool_calls = json.loads(row.get("tool_calls") or "[]") if row.get("tool_calls") else []',
          '        except Exception:',
          '            tool_calls = []',
          '        for tool_call in tool_calls or []:',
          '            function = tool_call.get("function") or {}',
          '            tool_name = str(function.get("name") or "").strip()',
          '            if not tool_name:',
          '                continue',
          '            tool_counts[tool_name] = tool_counts.get(tool_name, 0) + 1',
          '            message_totals["toolCalls"] += 1',
          '            if day:',
          '                daily[day]["toolCalls"] += 1',
          '    elif role == "tool":',
          '        message_totals["toolResults"] += 1',
          '        messages_by_session[session_id]["toolResults"] += 1',
          '        tool_name = str(row.get("tool_name") or "").strip()',
          '        if tool_name and tool_name not in tool_counts:',
          '            tool_counts[tool_name] = 0',
          '        content = str(row.get("content") or "")',
          '        lowered = content.lower()',
          '        if "\\"error\\"" in lowered or lowered.startswith("error:"):',
          '            message_totals["errors"] += 1',
          '            messages_by_session[session_id]["errors"] += 1',
          '            if day:',
          '                daily[day]["errors"] += 1',
          '',
          'totals = empty_totals()',
          'cost_daily = {}',
          'by_model = {}',
          'by_provider = {}',
          'by_channel = {}',
          'sessions = []',
          'relevant_sessions = 0',
          'included_sessions = 0',
          'estimated_sessions = 0',
          'actual_sessions = 0',
          'unknown_sessions = 0',
          '',
          'for row in session_rows:',
          '    session_id = str(row.get("id") or "")',
          '    total_cost, allocated, missing = allocate_cost(row)',
          '    total_tokens = int(row.get("input_tokens") or 0) + int(row.get("output_tokens") or 0) + int(row.get("cache_read_tokens") or 0) + int(row.get("cache_write_tokens") or 0)',
          '    status = str(row.get("cost_status") or "").strip().lower()',
          '    if total_tokens > 0:',
          '        relevant_sessions += 1',
          '        if status == "included":',
          '            included_sessions += 1',
          '        elif row.get("actual_cost_usd") is not None and float(row.get("actual_cost_usd") or 0) > 0:',
          '            actual_sessions += 1',
          '        elif total_cost > 0:',
          '            estimated_sessions += 1',
          '        else:',
          '            unknown_sessions += 1',
          '    add_totals(totals, row, total_cost, allocated, missing)',
          '    session_day = ""',
          '    started_at = float(row.get("started_at") or 0.0)',
          '    if started_at > 0:',
          '        cur.execute(\'SELECT date(?, "unixepoch", "localtime") AS d\', (started_at,))',
          '        session_day = (cur.fetchone()["d"] or "")',
          '    if session_day:',
          '        entry = cost_daily.get(session_day)',
          '        if not entry:',
          '            entry = empty_totals()',
          '            entry["date"] = session_day',
          '            cost_daily[session_day] = entry',
          '        add_totals(entry, row, total_cost, allocated, missing)',
          '        if session_day not in daily:',
          '            daily[session_day] = {"date": session_day, "tokens": 0, "cost": 0.0, "messages": 0, "toolCalls": 0, "errors": 0}',
          '        daily[session_day]["tokens"] += int(row.get("input_tokens") or 0) + int(row.get("output_tokens") or 0) + int(row.get("cache_read_tokens") or 0) + int(row.get("cache_write_tokens") or 0)',
          '        daily[session_day]["cost"] += total_cost',
          '    provider = str(row.get("billing_provider") or "").strip()',
          '    model = str(row.get("model") or "").strip()',
          '    source = str(row.get("source") or "").strip()',
          '    model_key = f"{provider}|{model}"',
          '    if model_key not in by_model:',
          '        by_model[model_key] = {"provider": provider or None, "model": model or None, "count": 0, "totals": empty_totals()}',
          '    by_model[model_key]["count"] += int(row.get("message_count") or 0)',
          '    add_totals(by_model[model_key]["totals"], row, total_cost, allocated, missing)',
          '    provider_key = provider or "unknown"',
          '    if provider_key not in by_provider:',
          '        by_provider[provider_key] = {"provider": provider or None, "model": provider or None, "count": 0, "totals": empty_totals()}',
          '    by_provider[provider_key]["count"] += int(row.get("message_count") or 0)',
          '    add_totals(by_provider[provider_key]["totals"], row, total_cost, allocated, missing)',
          '    channel_key = source or "unknown"',
          '    if channel_key not in by_channel:',
          '        by_channel[channel_key] = {"channel": channel_key, "totals": empty_totals()}',
          '    add_totals(by_channel[channel_key]["totals"], row, total_cost, allocated, missing)',
          '    session_message_counts = messages_by_session.get(session_id, {"total": 0, "user": 0, "assistant": 0, "toolResults": 0, "errors": 0})',
          '    sessions.append({',
          '        "key": session_id,',
          '        "label": row.get("title") or session_id,',
          '        "agentId": "main",',
          '        "channel": source or None,',
          '        "model": model or None,',
          '        "modelProvider": provider or None,',
          '        "updatedAt": int(float(row.get("ended_at") or row.get("started_at") or 0.0) * 1000) if (row.get("ended_at") or row.get("started_at")) else None,',
          '        "usage": {',
          '            "totalTokens": total_tokens,',
          '            "totalCost": total_cost,',
          '            "costStatus": row.get("cost_status") or None,',
          '            "costSource": row.get("cost_source") or None,',
          '            "messageCounts": {',
          '                "total": session_message_counts["total"],',
          '                "user": session_message_counts["user"],',
          '                "assistant": session_message_counts["assistant"],',
          '                "toolCalls": int(row.get("tool_call_count") or 0),',
          '                "toolResults": session_message_counts["toolResults"],',
          '                "errors": session_message_counts["errors"],',
          '            },',
          '        },',
          '    })',
          '',
          'tool_entries = [{"name": name, "count": count} for name, count in sorted(tool_counts.items(), key=lambda item: (-item[1], item[0]))]',
          'daily_usage = [daily[key] for key in sorted(daily.keys())]',
          'daily_cost = [cost_daily[key] for key in sorted(cost_daily.keys())]',
          'presentation_mode = "currency"',
          'if relevant_sessions > 0:',
          '    if included_sessions == relevant_sessions:',
          '        presentation_mode = "included"',
          '    elif unknown_sessions == relevant_sessions:',
          '        presentation_mode = "unknown"',
          '    elif included_sessions > 0 and (estimated_sessions > 0 or actual_sessions > 0 or unknown_sessions > 0):',
          '        presentation_mode = "mixed"',
          '    elif actual_sessions > 0 and estimated_sessions == 0 and unknown_sessions == 0:',
          '        presentation_mode = "actual"',
          '    elif estimated_sessions > 0:',
          '        presentation_mode = "estimated"',
          'presentation = {',
          '    "mode": presentation_mode,',
          '    "relevantSessions": relevant_sessions,',
          '    "includedSessions": included_sessions,',
          '    "estimatedSessions": estimated_sessions,',
          '    "actualSessions": actual_sessions,',
          '    "unknownSessions": unknown_sessions,',
          '}',
          'payload = {',
          '    "usageResult": {',
          '        "updatedAt": __import__("time").time() * 1000,',
          '        "startDate": start_date,',
          '        "endDate": end_date,',
          '        "sessions": sessions,',
          '        "totals": totals,',
          '        "aggregates": {',
          '            "messages": message_totals,',
          '            "tools": {"totalCalls": sum(item["count"] for item in tool_entries), "uniqueTools": len(tool_entries), "tools": tool_entries},',
          '            "byModel": list(by_model.values()),',
          '            "byProvider": list(by_provider.values()),',
          '            "byAgent": [{"agentId": "main", "totals": totals}] if sessions else [],',
          '            "byChannel": list(by_channel.values()),',
          '            "daily": daily_usage,',
          '        },',
          '        "costPresentation": presentation,',
          '    },',
          '    "costSummary": {',
          '        "updatedAt": __import__("time").time() * 1000,',
          '        "days": len(daily_cost),',
          '        "daily": daily_cost,',
          '        "totals": totals,',
          '        "costPresentation": presentation,',
          '    },',
          '}',
          'print(json.dumps(payload))',
        ].join('\n'),
        stateDbPath,
        startDate,
        endDate,
      ],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    );

    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.usageResult) || !isRecord(parsed.costSummary)) {
      throw new Error('Hermes usage query returned an invalid payload.');
    }

    return mergeHermesUsageLedger(
      parsed as HermesUsageBundle,
      this.usageLedger.readRange(startDate, endDate),
    );
  }

  getHermesStateDbPath(): string {
    return this.options.hermesStateDbPath?.trim() || join(this.hermesHomePath, 'state.db');
  }

  recordHermesRunUsageDelta(input: {
    sessionKey: string;
    sessionId: string;
    observedAtMs: number;
    baseline: HermesObservedSessionUsageSnapshot | null;
  }): void {
    const current = this.readHermesSessionUsageSnapshot(input.sessionId);
    if (!current) return;
    this.usageLedger.recordObservation({
      sessionId: input.sessionId,
      key: input.sessionKey,
      label: current.title?.trim() || input.sessionKey,
      agentId: 'main',
      channel: current.source?.trim() || undefined,
      model: current.model?.trim() || undefined,
      modelProvider: current.billingProvider?.trim() || undefined,
      costStatus: current.costStatus?.trim() || undefined,
      costSource: current.costSource?.trim() || undefined,
      observedAtMs: input.observedAtMs,
      startedAtMs: current.startedAtMs ?? undefined,
      currentTotals: current.totals,
      baselineTotals: input.baseline?.totals ?? null,
      allowAbsoluteBootstrap: input.baseline == null && isSameLocalDate(input.observedAtMs, current.startedAtMs),
    });
  }

  readHermesSessionUsageSnapshot(sessionId: string): HermesObservedSessionUsageSnapshot | null {
    if (!sessionId.trim()) return null;
    const stateDbPath = this.getHermesStateDbPath();
    if (!existsSync(stateDbPath)) return null;

    try {
      const raw = execFileSync(
        'python3',
        [
          '-c',
          [
            'import json, pathlib, sqlite3, sys',
            'db_path, session_id = sys.argv[1], sys.argv[2]',
            'db_uri = pathlib.Path(db_path).resolve().as_uri() + "?mode=ro"',
            'conn = sqlite3.connect(db_uri, uri=True)',
            'conn.execute("PRAGMA query_only = ON")',
            'conn.row_factory = sqlite3.Row',
            'cur = conn.cursor()',
            'cur.execute("""',
            'SELECT id, source, model, title, started_at, ended_at, billing_provider, cost_status, cost_source,',
            '       input_tokens, output_tokens, cache_read_tokens, cache_write_tokens,',
            '       estimated_cost_usd, actual_cost_usd',
            'FROM sessions',
            'WHERE id = ?',
            'LIMIT 1',
            '""", (session_id,))',
            'row = cur.fetchone()',
            'if not row:',
            '    print("null")',
            'else:',
            '    raw_cost = row["actual_cost_usd"]',
            '    if raw_cost is None:',
            '        raw_cost = row["estimated_cost_usd"]',
            '    payload = {',
            '        "sessionId": row["id"],',
            '        "startedAtMs": int(float(row["started_at"]) * 1000) if row["started_at"] is not None else None,',
            '        "endedAtMs": int(float(row["ended_at"]) * 1000) if row["ended_at"] is not None else None,',
            '        "title": row["title"],',
            '        "source": row["source"],',
            '        "model": row["model"],',
            '        "billingProvider": row["billing_provider"],',
            '        "costStatus": row["cost_status"],',
            '        "costSource": row["cost_source"],',
            '        "totals": {',
            '            "input": int(row["input_tokens"] or 0),',
            '            "output": int(row["output_tokens"] or 0),',
            '            "cacheRead": int(row["cache_read_tokens"] or 0),',
            '            "cacheWrite": int(row["cache_write_tokens"] or 0),',
            '            "totalTokens": int(row["input_tokens"] or 0) + int(row["output_tokens"] or 0) + int(row["cache_read_tokens"] or 0) + int(row["cache_write_tokens"] or 0),',
            '            "totalCost": float(raw_cost or 0.0),',
            '            "inputCost": 0.0,',
            '            "outputCost": 0.0,',
            '            "cacheReadCost": 0.0,',
            '            "cacheWriteCost": 0.0,',
            '            "missingCostEntries": 1 if (int(row["input_tokens"] or 0) + int(row["output_tokens"] or 0) + int(row["cache_read_tokens"] or 0) + int(row["cache_write_tokens"] or 0)) > 0 and float(raw_cost or 0.0) <= 0 and str(row["cost_status"] or "") not in ("included", "none") else 0,',
            '        },',
            '    }',
            '    total_tokens = payload["totals"]["totalTokens"]',
            '    total_cost = payload["totals"]["totalCost"]',
            '    if total_tokens > 0 and total_cost > 0:',
            '        payload["totals"]["inputCost"] = total_cost * (payload["totals"]["input"] / total_tokens)',
            '        payload["totals"]["outputCost"] = total_cost * (payload["totals"]["output"] / total_tokens)',
            '        payload["totals"]["cacheReadCost"] = total_cost * (payload["totals"]["cacheRead"] / total_tokens)',
            '        payload["totals"]["cacheWriteCost"] = total_cost * (payload["totals"]["cacheWrite"] / total_tokens)',
            '    print(json.dumps(payload))',
          ].join('\n'),
          stateDbPath,
          sessionId,
        ],
        {
          encoding: 'utf8',
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();

      if (!raw || raw === 'null') return null;
      const parsed = JSON.parse(raw) as HermesObservedSessionUsageSnapshot;
      return parsed;
    } catch {
      return null;
    }
  }
}

function createEmptyHermesUsageTotals(): HermesUsageTotals {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    totalCost: 0,
    inputCost: 0,
    outputCost: 0,
    cacheReadCost: 0,
    cacheWriteCost: 0,
    missingCostEntries: 0,
  };
}

function countDateRangeDays(startDate: string, endDate: string): number {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end < start) {
    return 0;
  }
  return Math.floor((end.valueOf() - start.valueOf()) / 86_400_000) + 1;
}

function cloneHermesUsageTotals(value?: Partial<HermesUsageTotals> | null): HermesUsageTotals {
  return {
    ...createEmptyHermesUsageTotals(),
    ...(value ?? {}),
  };
}

function addHermesUsageTotals(target: HermesUsageTotals, value?: Partial<HermesUsageTotals> | null): void {
  if (!value) return;
  target.input += value.input ?? 0;
  target.output += value.output ?? 0;
  target.cacheRead += value.cacheRead ?? 0;
  target.cacheWrite += value.cacheWrite ?? 0;
  target.totalTokens += value.totalTokens ?? 0;
  target.totalCost += value.totalCost ?? 0;
  target.inputCost += value.inputCost ?? 0;
  target.outputCost += value.outputCost ?? 0;
  target.cacheReadCost += value.cacheReadCost ?? 0;
  target.cacheWriteCost += value.cacheWriteCost ?? 0;
  target.missingCostEntries += value.missingCostEntries ?? 0;
}

function subtractHermesUsageTotals(current: HermesUsageTotals, baseline?: HermesUsageTotals | null): HermesUsageTotals {
  if (!baseline) {
    return cloneHermesUsageTotals(current);
  }
  return {
    input: Math.max(0, current.input - baseline.input),
    output: Math.max(0, current.output - baseline.output),
    cacheRead: Math.max(0, current.cacheRead - baseline.cacheRead),
    cacheWrite: Math.max(0, current.cacheWrite - baseline.cacheWrite),
    totalTokens: Math.max(0, current.totalTokens - baseline.totalTokens),
    totalCost: Math.max(0, current.totalCost - baseline.totalCost),
    inputCost: Math.max(0, current.inputCost - baseline.inputCost),
    outputCost: Math.max(0, current.outputCost - baseline.outputCost),
    cacheReadCost: Math.max(0, current.cacheReadCost - baseline.cacheReadCost),
    cacheWriteCost: Math.max(0, current.cacheWriteCost - baseline.cacheWriteCost),
    missingCostEntries: Math.max(0, current.missingCostEntries - baseline.missingCostEntries),
  };
}

function getLocalDateKey(input: number | Date): string {
  const value = input instanceof Date ? input : new Date(input);
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function isSameLocalDate(leftMs: number, rightMs: number | null | undefined): boolean {
  if (rightMs == null || !Number.isFinite(rightMs)) return false;
  return getLocalDateKey(leftMs) === getLocalDateKey(rightMs);
}

function resolveHermesCostPresentationFromSessions(sessions: Array<{ usage?: { totalTokens?: number; totalCost?: number; costStatus?: string } | null }>): HermesUsageResult['costPresentation'] {
  let relevantSessions = 0;
  let includedSessions = 0;
  let estimatedSessions = 0;
  let actualSessions = 0;
  let unknownSessions = 0;
  for (const session of sessions) {
    const usage = session.usage;
    if (!usage) continue;
    const totalTokens = usage.totalTokens ?? 0;
    if (totalTokens <= 0) continue;
    relevantSessions += 1;
    const status = (usage.costStatus ?? '').trim().toLowerCase();
    if (status === 'included') {
      includedSessions += 1;
    } else if (status === 'actual') {
      actualSessions += 1;
    } else if (status === 'estimated' || (usage.totalCost ?? 0) > 0) {
      estimatedSessions += 1;
    } else {
      unknownSessions += 1;
    }
  }

  let mode: NonNullable<HermesUsageResult['costPresentation']>['mode'] = 'currency';
  if (relevantSessions > 0) {
    if (includedSessions === relevantSessions) {
      mode = 'included';
    } else if (unknownSessions === relevantSessions) {
      mode = 'unknown';
    } else if (includedSessions > 0 && (estimatedSessions > 0 || actualSessions > 0 || unknownSessions > 0)) {
      mode = 'mixed';
    } else if (actualSessions > 0 && estimatedSessions === 0 && unknownSessions === 0) {
      mode = 'actual';
    } else if (estimatedSessions > 0) {
      mode = 'estimated';
    }
  }

  return {
    mode,
    relevantSessions,
    includedSessions,
    estimatedSessions,
    actualSessions,
    unknownSessions,
  };
}

function mergeHermesUsageLedger(base: HermesUsageBundle, ledgerDays: HermesUsageLedgerDayRecord[]): HermesUsageBundle {
  if (ledgerDays.length === 0) return base;

  const usageResult: HermesUsageResult = {
    updatedAt: base.usageResult.updatedAt,
    startDate: base.usageResult.startDate,
    endDate: base.usageResult.endDate,
    sessions: [...(base.usageResult.sessions ?? [])],
    totals: cloneHermesUsageTotals(base.usageResult.totals),
    aggregates: {
      messages: { ...(base.usageResult.aggregates?.messages ?? { total: 0, user: 0, assistant: 0, toolCalls: 0, toolResults: 0, errors: 0 }) },
      tools: {
        totalCalls: base.usageResult.aggregates?.tools?.totalCalls ?? 0,
        uniqueTools: base.usageResult.aggregates?.tools?.uniqueTools ?? 0,
        tools: [...(base.usageResult.aggregates?.tools?.tools ?? [])],
      },
      byModel: [...(base.usageResult.aggregates?.byModel ?? [])],
      byProvider: [...(base.usageResult.aggregates?.byProvider ?? [])],
      byAgent: [...(base.usageResult.aggregates?.byAgent ?? [])],
      byChannel: [...(base.usageResult.aggregates?.byChannel ?? [])],
      daily: [...(base.usageResult.aggregates?.daily ?? [])],
    },
    costPresentation: base.usageResult.costPresentation,
  };
  const costSummary: HermesCostSummary = {
    updatedAt: base.costSummary.updatedAt,
    days: base.costSummary.days,
    daily: [...(base.costSummary.daily ?? [])],
    totals: cloneHermesUsageTotals(base.costSummary.totals),
    costPresentation: base.costSummary.costPresentation,
  };
  const usageTotals = usageResult.totals ?? createEmptyHermesUsageTotals();
  const costTotals = costSummary.totals ?? createEmptyHermesUsageTotals();
  usageResult.totals = usageTotals;
  costSummary.totals = costTotals;

  const existingSessionIds = new Set((usageResult.sessions ?? []).map((session) => session.key));
  const dailyUsageMap = new Map((usageResult.aggregates?.daily ?? []).map((entry) => [entry.date, { ...entry }]));
  const dailyCostMap = new Map((costSummary.daily ?? []).map((entry) => [entry.date, {
    ...cloneHermesUsageTotals(entry),
    date: entry.date,
  } as HermesUsageTotals & { date: string }]));

  for (const day of ledgerDays) {
    for (const [sessionId, entry] of Object.entries(day.sessions)) {
      if (existingSessionIds.has(sessionId)) continue;

      const dailyUsage = dailyUsageMap.get(day.date) ?? {
        date: day.date,
        tokens: 0,
        cost: 0,
        messages: 0,
        toolCalls: 0,
        errors: 0,
      };
      dailyUsage.tokens += entry.totals.totalTokens;
      dailyUsage.cost += entry.totals.totalCost;
      dailyUsageMap.set(day.date, dailyUsage);

      const dailyCost = (dailyCostMap.get(day.date) ?? {
        ...createEmptyHermesUsageTotals(),
        date: day.date,
      }) as HermesUsageTotals & { date: string };
      addHermesUsageTotals(dailyCost, entry.totals);
      dailyCostMap.set(day.date, dailyCost);
    }
  }

  const mergedSessions = new Map((usageResult.sessions ?? []).map((session) => [session.key, session]));
  for (const day of ledgerDays) {
    for (const [sessionId, entry] of Object.entries(day.sessions)) {
      if (existingSessionIds.has(sessionId)) continue;
      const existing = mergedSessions.get(sessionId);
      if (existing) {
        existing.usage = {
          totalTokens: (existing.usage?.totalTokens ?? 0) + entry.totals.totalTokens,
          totalCost: (existing.usage?.totalCost ?? 0) + entry.totals.totalCost,
          costStatus: existing.usage?.costStatus ?? entry.costStatus,
          costSource: existing.usage?.costSource ?? entry.costSource,
          messageCounts: existing.usage?.messageCounts ?? {
            total: 0,
            user: 0,
            assistant: 0,
            toolCalls: 0,
            toolResults: 0,
            errors: 0,
          },
        };
        existing.updatedAt = Math.max(existing.updatedAt ?? 0, entry.updatedAt);
        continue;
      }
      mergedSessions.set(sessionId, {
        key: sessionId,
        label: entry.label,
        agentId: entry.agentId,
        channel: entry.channel,
        model: entry.model,
        modelProvider: entry.modelProvider,
        updatedAt: entry.updatedAt,
        usage: {
          totalTokens: entry.totals.totalTokens,
          totalCost: entry.totals.totalCost,
          costStatus: entry.costStatus,
          costSource: entry.costSource,
          messageCounts: {
            total: 0,
            user: 0,
            assistant: 0,
            toolCalls: 0,
            toolResults: 0,
            errors: 0,
          },
        },
      });
    }
  }

  const addedSessions = [...mergedSessions.values()].filter((session) => !existingSessionIds.has(session.key));
  for (const session of addedSessions) {
    addHermesUsageTotals(usageTotals, {
      totalTokens: session.usage?.totalTokens ?? 0,
      totalCost: session.usage?.totalCost ?? 0,
    });
    addHermesUsageTotals(costTotals, {
      totalTokens: session.usage?.totalTokens ?? 0,
      totalCost: session.usage?.totalCost ?? 0,
    });

    upsertHermesUsageModelTotals(usageResult.aggregates?.byModel ?? [], session.modelProvider, session.model, session.usage?.totalTokens ?? 0, session.usage?.totalCost ?? 0);
    upsertHermesUsageModelTotals(usageResult.aggregates?.byProvider ?? [], session.modelProvider, session.modelProvider, session.usage?.totalTokens ?? 0, session.usage?.totalCost ?? 0);
    upsertHermesUsageChannelTotals(usageResult.aggregates?.byChannel ?? [], session.channel, session.usage?.totalTokens ?? 0, session.usage?.totalCost ?? 0);
  }

  if (usageResult.aggregates) {
    usageResult.aggregates.daily = [...dailyUsageMap.values()].sort((left, right) => left.date.localeCompare(right.date));
    usageResult.aggregates.byAgent = usageResult.sessions && usageResult.sessions.length > 0
      ? [{ agentId: 'main', totals: cloneHermesUsageTotals(usageResult.totals) }]
      : [];
  }
  costSummary.daily = [...dailyCostMap.values()].sort((left, right) => left.date.localeCompare(right.date));
  costSummary.days = costSummary.daily.length;

  usageResult.sessions = [...mergedSessions.values()].sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  usageResult.costPresentation = resolveHermesCostPresentationFromSessions(usageResult.sessions);
  costSummary.costPresentation = usageResult.costPresentation;

  return {
    usageResult,
    costSummary,
  };
}

function upsertHermesUsageModelTotals(
  entries: Array<{ provider?: string; model?: string; count: number; totals: HermesUsageTotals }>,
  provider: string | undefined,
  model: string | undefined,
  totalTokens: number,
  totalCost: number,
): void {
  const target = entries.find((entry) => (entry.provider ?? null) === (provider ?? null) && (entry.model ?? null) === (model ?? null));
  if (target) {
    addHermesUsageTotals(target.totals, { totalTokens, totalCost });
    return;
  }
  entries.push({
    provider,
    model,
    count: 0,
    totals: cloneHermesUsageTotals({ totalTokens, totalCost }),
  });
}

function upsertHermesUsageChannelTotals(
  entries: Array<{ channel: string; totals: HermesUsageTotals }>,
  channel: string | undefined,
  totalTokens: number,
  totalCost: number,
): void {
  const normalized = channel?.trim() || 'unknown';
  const target = entries.find((entry) => entry.channel === normalized);
  if (target) {
    addHermesUsageTotals(target.totals, { totalTokens, totalCost });
    return;
  }
  entries.push({
    channel: normalized,
    totals: cloneHermesUsageTotals({ totalTokens, totalCost }),
  });
}

export class HermesUsageLedgerStore {
  private state: HermesUsageLedgerPersistedState;
  private readonly persister: DebouncedFilePersister;

  constructor(private readonly filePath: string) {
    this.state = this.load();
    this.persister = new DebouncedFilePersister(filePath);
  }

  async flush(): Promise<void> {
    return this.persister.flush();
  }

  readRange(startDate: string, endDate: string): HermesUsageLedgerDayRecord[] {
    return Object.values(this.state.days)
      .filter((entry) => entry.date >= startDate && entry.date <= endDate)
      .sort((left, right) => left.date.localeCompare(right.date))
      .map((entry) => ({
        date: entry.date,
        sessions: Object.fromEntries(Object.entries(entry.sessions).map(([sessionId, value]) => [
          sessionId,
          {
            ...value,
            totals: cloneHermesUsageTotals(value.totals),
          },
        ])),
      }));
  }

  recordObservation(input: {
    sessionId: string;
    key: string;
    label: string;
    agentId: string;
    channel?: string;
    model?: string;
    modelProvider?: string;
    costStatus?: string;
    costSource?: string;
    observedAtMs: number;
    startedAtMs?: number;
    currentTotals: HermesUsageTotals;
    baselineTotals: HermesUsageTotals | null;
    allowAbsoluteBootstrap: boolean;
  }): void {
    const previous = this.state.snapshots[input.sessionId];
    const baselineTotals = input.baselineTotals ?? previous?.totals ?? null;
    const delta = baselineTotals
      ? subtractHermesUsageTotals(input.currentTotals, baselineTotals)
      : input.allowAbsoluteBootstrap
        ? cloneHermesUsageTotals(input.currentTotals)
        : createEmptyHermesUsageTotals();
    const hasDelta = delta.totalTokens > 0 || delta.totalCost > 0 || delta.input > 0 || delta.output > 0 || delta.cacheRead > 0 || delta.cacheWrite > 0;
    if (hasDelta) {
      const date = getLocalDateKey(input.observedAtMs);
      const day = this.state.days[date] ?? { date, sessions: {} };
      const existing = day.sessions[input.sessionId];
      if (existing) {
        addHermesUsageTotals(existing.totals, delta);
        existing.updatedAt = Math.max(existing.updatedAt, input.observedAtMs);
        existing.label = input.label;
        existing.key = input.key;
        existing.agentId = input.agentId;
        existing.channel = input.channel;
        existing.model = input.model;
        existing.modelProvider = input.modelProvider;
        existing.costStatus = input.costStatus;
        existing.costSource = input.costSource;
      } else {
        day.sessions[input.sessionId] = {
          key: input.key,
          label: input.label,
          agentId: input.agentId,
          channel: input.channel,
          model: input.model,
          modelProvider: input.modelProvider,
          costStatus: input.costStatus,
          costSource: input.costSource,
          updatedAt: input.observedAtMs,
          totals: cloneHermesUsageTotals(delta),
        };
      }
      this.state.days[date] = day;
    }

    this.state.snapshots[input.sessionId] = {
      sessionId: input.sessionId,
      key: input.key,
      label: input.label,
      agentId: input.agentId,
      channel: input.channel,
      model: input.model,
      modelProvider: input.modelProvider,
      costStatus: input.costStatus,
      costSource: input.costSource,
      updatedAt: input.observedAtMs,
      startedAtMs: input.startedAtMs,
      totals: cloneHermesUsageTotals(input.currentTotals),
    };
    this.save();
  }

  private load(): HermesUsageLedgerPersistedState {
    if (!existsSync(this.filePath)) {
      return {
        version: 1,
        snapshots: {},
        days: {},
      };
    }
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8')) as Partial<HermesUsageLedgerPersistedState>;
      return {
        version: 1,
        snapshots: isRecord(parsed.snapshots) ? parsed.snapshots as Record<string, HermesUsageLedgerSnapshotRecord> : {},
        days: isRecord(parsed.days) ? parsed.days as Record<string, HermesUsageLedgerDayRecord> : {},
      };
    } catch {
      return {
        version: 1,
        snapshots: {},
        days: {},
      };
    }
  }

  private save(): void {
    this.persister.schedule(() => JSON.stringify(this.state, null, 2) + '\n');
  }
}
