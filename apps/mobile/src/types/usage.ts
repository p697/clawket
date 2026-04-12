export type UsageTotals = {
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

export type CostPresentation = {
  mode: 'currency' | 'included' | 'estimated' | 'actual' | 'unknown' | 'mixed';
  relevantSessions?: number;
  includedSessions?: number;
  estimatedSessions?: number;
  actualSessions?: number;
  unknownSessions?: number;
};

export type UsageDailyEntry = {
  date: string;
  tokens: number;
  cost: number;
  messages: number;
  toolCalls: number;
  errors: number;
};

export type UsageModelEntry = {
  provider?: string;
  model?: string;
  count: number;
  totals: UsageTotals;
};

export type UsageToolEntry = {
  name: string;
  count: number;
};

export type UsageSessionEntry = {
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
};

export type UsageAggregates = {
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
    tools: UsageToolEntry[];
  };
  byModel: UsageModelEntry[];
  byProvider: UsageModelEntry[];
  byAgent: Array<{ agentId: string; totals: UsageTotals }>;
  byChannel: Array<{ channel: string; totals: UsageTotals }>;
  daily: UsageDailyEntry[];
};

export type UsageResult = {
  updatedAt?: number;
  startDate?: string;
  endDate?: string;
  sessions?: UsageSessionEntry[];
  totals?: UsageTotals;
  aggregates?: UsageAggregates;
  costPresentation?: CostPresentation;
};

export type CostDailyEntry = UsageTotals & { date: string };

export type CostSummary = {
  updatedAt?: number;
  days?: number;
  daily?: CostDailyEntry[];
  totals?: UsageTotals;
  costPresentation?: CostPresentation;
};
