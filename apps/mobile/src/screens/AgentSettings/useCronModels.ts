import { useCallback, useEffect, useRef, useState } from 'react';
import type { AgentAdapter, ModelInfo } from '@clawket/agent-protocol';
import { modelReference } from '../../utils/model-catalog';

export type CronModelOptions = Readonly<{
  models: ReadonlyArray<ModelInfo>;
  /** `provider/model` the Agent runs when a job has no override; empty when unknown. */
  defaultModel: string;
  loading: boolean;
  error: unknown;
  reload: () => void;
}>;

// Model choices for the Cron editor's model row. Loaded once per adapter while
// `enabled`; failures leave the row usable with the raw reference and no list.
export function useCronModels(adapter: AgentAdapter, enabled: boolean): CronModelOptions {
  const [models, setModels] = useState<ReadonlyArray<ModelInfo>>([]);
  const [defaultModel, setDefaultModel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [refresh, setRefresh] = useState(0);
  const request = useRef(0);
  const reload = useCallback(() => setRefresh(value => value + 1), []);
  useEffect(() => {
    const operations = adapter.management?.models;
    if (!enabled || !operations || (!operations.getSelection && !operations.list)) { setLoading(false); return; }
    const current = ++request.current;
    setLoading(true);
    (async () => {
      const selection = operations.getSelection ? await operations.getSelection() : null;
      const list = selection?.models.length ? selection.models : operations.list ? await operations.list() : [];
      return { list, fallback: selection ? modelReference(selection.currentProvider, selection.currentModel) : '' };
    })().then(({ list, fallback }) => {
      if (request.current !== current) return;
      setModels(list);
      setDefaultModel(fallback);
      setError(null);
    }, (reason: unknown) => {
      if (request.current === current) setError(reason);
    }).finally(() => {
      if (request.current === current) setLoading(false);
    });
    return () => { request.current++; };
  }, [adapter, enabled, refresh]);
  return { models, defaultModel, loading, error, reload };
}
