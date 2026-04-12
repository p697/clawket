type HermesModelDisplayInput = {
  currentModel?: string | null;
  currentProvider?: string | null;
  loading?: boolean;
  error?: boolean;
};

export type HermesModelDisplayState = {
  model: string | null;
  provider: string | null;
  status: 'loading' | 'ready' | 'unavailable';
};

function normalizeText(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function resolveHermesModelDisplayState({
  currentModel,
  currentProvider,
  loading = false,
  error = false,
}: HermesModelDisplayInput): HermesModelDisplayState {
  const model = normalizeText(currentModel);
  const provider = normalizeText(currentProvider);

  if (model) {
    return {
      model,
      provider,
      status: 'ready',
    };
  }

  if (loading && !error) {
    return {
      model: null,
      provider: null,
      status: 'loading',
    };
  }

  return {
    model: null,
    provider,
    status: 'unavailable',
  };
}
