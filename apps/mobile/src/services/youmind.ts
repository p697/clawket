import * as Application from 'expo-application';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { Platform } from 'react-native';
import { sha256 } from 'js-sha256';
import { publicYouMindAuthConfig } from '../config/public';
import i18n from '../i18n';
import { StorageService, type YouMindAuthSession } from './storage';
import { parseYouMindSuccessPayload } from '../connection/adapters/youmind-sprite-api';
export type { YouMindAuthSession } from './storage';

type YouMindUser = {
  id?: string;
  email?: string;
  name?: string;
  avatarUrl?: string;
};

export type YouMindProductTier = 'free' | 'pro' | 'max';

export type YouMindSubscription = {
  id: string;
  productTier: YouMindProductTier;
  provider: string | null;
  billingInterval: string | null;
  renewAtMs: number | null;
  externalId: string | null;
};

export type YouMindCurrentUser = {
  id: string;
  email: string | null;
  name: string | null;
  avatarUrl: string | null;
  timeZone: string | null;
  subscription: YouMindSubscription | null;
};

export type YouMindCreditAccount = {
  id: string;
  spaceId: string;
  monthlyBalance: number;
  monthlyQuota: number;
  permanentBalance: number;
  dailyBalance: number;
  bonusBalance: number;
  dailyUsed: number;
  dailyLimit: number;
  freeMonthlyDailyGrantCount: number | null;
  freeMonthlyDailyGrantMax: number | null;
  freeMonthlyFirstDailyGrantAtMs: number | null;
  productTier: YouMindProductTier;
  subTier: number;
  currentPeriodStartMs: number;
  currentPeriodEndMs: number;
  refreshCycleAnchorMs: number;
};

export type YouMindCreditCategory =
  | 'chat'
  | 'writing'
  | 'search'
  | 'image'
  | 'audio'
  | 'parsing'
  | 'video';

export type YouMindCreditCategorySummary = Record<YouMindCreditCategory, number>;

export type YouMindCreditDailyBreakdown = {
  date: string;
} & Record<YouMindCreditCategory, number>;

export type YouMindCreditUsagePeriod = {
  summary: {
    totalConsumed: number;
    byCategory: YouMindCreditCategorySummary;
  };
  dailyBreakdown: YouMindCreditDailyBreakdown[];
  currentPeriodStartMs: number;
  currentPeriodEndMs: number;
};

export type YouMindCreditUsageLast30Days = {
  summary: {
    totalConsumed: number;
    byCategory: YouMindCreditCategorySummary;
  };
  dailyBreakdown: YouMindCreditDailyBreakdown[];
  currentPeriodStartDate: string;
  currentPeriodEndDate: string;
};

export type YouMindPermanentCreditGrant = {
  id: string;
  amount: number;
  reason: string;
  createdAtMs: number;
};

export type YouMindPagination = {
  current: number;
  pageSize: number;
  total: number;
};

export type YouMindPermanentCreditGrantPage = {
  data: YouMindPermanentCreditGrant[];
  paging: YouMindPagination | null;
};

export type YouMindIdTokenProvider = 'apple' | 'google';

export type YouMindChatSummary = {
  id: string;
  title: string;
  updatedAtMs: number;
  createdAtMs: number;
};

export type YouMindChatSkill = {
  id: string;
  name: string;
  config?: Record<string, unknown>;
};

export type YouMindChatAttachmentReference =
  | {
    type: 'material';
    id: string;
    entity_type: 'snip';
    from: 'user';
    at_name: string;
  }
  | {
    type: 'inlineImage';
    image_url: string;
    at_name: string;
  };

export type YouMindPendingChatAttachment = {
  uri: string;
  mimeType: string;
  fileName?: string;
};

export type YouMindChatAttachment = {
  kind: 'image' | 'file';
  url: string;
  name: string;
  mimeType?: string;
};

export type YouMindSkillSummary = {
  id: string;
  name: string;
  description: string;
  iconBgColor: string | null;
  iconValue: string | null;
  origin: string | null;
  creatorId: string | null;
};

export type YouMindInstalledSkills = {
  all: YouMindSkillSummary[];
  pinned: YouMindSkillSummary[];
  mySkills: YouMindSkillSummary[];
  installed: YouMindSkillSummary[];
};

export type YouMindBoardSummary = {
  id: string;
  name: string;
  description: string;
  status: string;
  type: string;
  isFavorited: boolean;
  icon: {
    name: string | null;
    color: string | null;
  } | null;
  updatedAtMs: number;
  createdAtMs: number;
  materialCount: number;
  craftCount: number;
  totalCount: number;
  heroImageUrls: string[];
};

export type YouMindBoardEntryKind = 'material' | 'craft' | 'group' | 'chat';
export type YouMindBoardEntrySection = 'materials' | 'crafts';
export type YouMindBoardEntryFilterType =
  | 'group'
  | 'note'
  | 'chat'
  | 'article'
  | 'image'
  | 'pdf'
  | 'office'
  | 'text-file'
  | 'audio'
  | 'video'
  | 'snippet'
  | 'page'
  | 'audio-pod'
  | 'webpage'
  | 'slides'
  | 'canvas'
  | 'memory';
export type YouMindBoardEntryIcon =
  | {
    kind: 'image';
    url: string;
    fallbackUrl?: string | null;
  }
  | {
    kind: 'group';
    color: string | null;
  }
  | {
    kind: 'document' | 'webpage' | 'slides' | 'audio-pod' | 'canvas' | 'memory';
  };

export type YouMindBoardEntryCardVariant =
  | 'group'
  | 'note'
  | 'article'
  | 'image'
  | 'file'
  | 'chat'
  | 'page'
  | 'audio-pod'
  | 'webpage'
  | 'slides'
  | 'canvas'
  | 'memory';

export type YouMindBoardEntryCard = {
  variant: YouMindBoardEntryCardVariant;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  imageUrl?: string | null;
  faviconUrl?: string | null;
  backdropUrl?: string | null;
  aspectRatio?: number | null;
};

export type YouMindBoardEntry = {
  id: string;
  kind: YouMindBoardEntryKind;
  section: YouMindBoardEntrySection;
  filterType: YouMindBoardEntryFilterType;
  icon: YouMindBoardEntryIcon;
  card: YouMindBoardEntryCard;
  title: string;
  subtitle: string;
  rank: string;
  updatedAtMs: number;
  depth: number;
  detailPath: string | null;
  detailTitle: string;
};

export type YouMindBoardDetail = {
  id: string;
  name: string;
  description: string;
  updatedAtMs: number;
  createdAtMs: number;
  entries: YouMindBoardEntry[];
  materials: YouMindBoardEntry[];
  crafts: YouMindBoardEntry[];
};

export type YouMindContentBlock = {
  id: string;
  kind: 'content';
  status?: string;
  text: string;
};

export type YouMindReasoningBlock = {
  id: string;
  kind: 'reasoning';
  status?: string;
  text: string;
};

export type YouMindToolBlock = {
  id: string;
  kind: 'tool';
  status?: string;
  toolName: string;
  toolResponse?: string;
  toolArguments?: unknown;
  toolResult?: unknown;
  elapsedMs?: number;
};

export type YouMindAssistantBlock = YouMindContentBlock | YouMindReasoningBlock | YouMindToolBlock;

export type YouMindChatMessage =
  | {
    id: string;
    role: 'user';
    createdAtMs: number;
    content: string;
    skill?: YouMindChatSkill;
    attachments?: YouMindChatAttachment[];
  }
  | {
    id: string;
    role: 'assistant';
    createdAtMs: number;
    model?: string;
    status?: string;
    blocks: YouMindAssistantBlock[];
  };

export type YouMindChatDetail = {
  id: string;
  title: string;
  createdAtMs: number;
  updatedAtMs: number;
  messages: YouMindChatMessage[];
};

const YOUMIND_MESSAGE_MODE_AGENT = 'agent';
const YOUMIND_LOCAL_ASSISTANT_PLACEHOLDER_PREFIX = 'local-assistant-';

type CompletionChunk =
  | {
    mode: 'insert';
    dataType: 'Chat' | 'ChatDetail' | 'Message' | 'CompletionBlock';
    data: any;
  }
  | {
    mode: 'replace';
    targetType: 'Chat' | 'Message' | 'CompletionBlock';
    targetId: string;
    path: string;
    data: any;
  }
  | {
    mode: 'append_string';
    targetType: 'Chat' | 'Message' | 'CompletionBlock';
    targetId: string;
    path: string;
    data: string;
  }
  | {
    mode: 'append_json';
    targetType: 'Chat' | 'Message' | 'CompletionBlock';
    targetId: string;
    path: string;
    data: string;
  }
  | {
    mode: 'event';
    event: string;
    data?: any;
  }
  | {
    mode: 'error';
    error?: {
      message?: string;
      code?: string;
      status?: number;
    };
  };

type RequestOptions = {
  method?: 'GET' | 'POST';
  body?: unknown;
  accessToken?: string;
  signal?: AbortSignal;
  bodyText?: string;
  extraHeaders?: Record<string, string>;
};

class YouMindApiError extends Error {
  readonly status: number;
  readonly code: string | null;

  constructor(message: string, options: { status: number; code?: string | null }) {
    super(message);
    this.name = 'YouMindApiError';
    this.status = options.status;
    this.code = options.code ?? null;
  }
}

type CurrentUserResponse = {
  id?: string;
  email?: string;
  displayName?: string;
  name?: string;
  avatar?: string;
  avatarUrl?: string;
  picture?: string;
  timeZone?: string;
  space?: {
    subscription?: {
      id?: string;
      productTier?: string;
      provider?: string;
      billingInterval?: string;
      renewAt?: string;
      renewCycleAnchor?: string;
      externalId?: string;
    } | null;
  } | null;
};

type YouMindBoardResponse = {
  id: string;
  name?: string;
};

type YouMindMaterialCreateResponse = {
  id?: string;
  title?: string;
  name?: string;
};

type YouMindBoardDetailResponse = {
  id?: string;
  name?: string;
  description?: string;
  createdAt?: string;
  updatedAt?: string;
  boardItems?: any[];
  board_items?: any[];
};

type YouMindPackResponse = {
  id?: string;
  skills?: unknown[];
};

type YouMindInstalledSkillsResponse = {
  all?: unknown[];
  pinned?: unknown[];
  my_skills?: unknown[];
  installed?: unknown[];
};

type YouMindBoardListNode = {
  id: string;
  parentId: string | null;
  rank: string;
  updatedAtMs: number;
  sourceIndex: number;
  entry: Omit<YouMindBoardEntry, 'depth'>;
};

const REFRESH_THRESHOLD_RATIO = 0.1;
const REFRESH_THRESHOLD_MIN_MS = 30_000;
const YOUMIND_APP_ID = '0';
const YOUMIND_NONCE_BYTES = 12;
const WEBSITE_ICON = 'https://cdn.gooo.ai/assets/webpage-icon-v3.png';
const SNIPPET_ICON = 'https://cdn.gooo.ai/assets/snippet-icon-v3.png';
const THOUGHT_ICON = 'https://cdn.gooo.ai/assets/note-icon-v4.png';
const AUDIO_ICON = 'https://cdn.gooo.ai/assets/audio-icon-v3.png';
const CHAT_ICON = 'https://cdn.gooo.ai/assets/chat-icon-v3.png';
const VIDEO_ICON = 'https://cdn.gooo.ai/assets/video-icon-v3.png';
const IMAGE_ICON = 'https://cdn.gooo.ai/assets/board-image-icon2.png';
const MATERIAL_TEXT_FILE_ICON = 'https://cdn.gooo.ai/assets/material-text.png';
const MATERIAL_TXT_ICON = 'https://cdn.gooo.ai/assets/material-txt.png';
const MATERIAL_MARKDOWN_ICON = 'https://cdn.gooo.ai/assets/material-markdown.png';
const MATERIAL_WORD_ICON = 'https://cdn.gooo.ai/assets/material-word.png';
const MATERIAL_PPT_ICON = 'https://cdn.gooo.ai/assets/material-ppt.png';
const MATERIAL_EXCEL_ICON = 'https://cdn.gooo.ai/assets/material-excel.png';
const MATERIAL_PDF_ICON = 'https://cdn.gooo.ai/assets/material-pdf.png';

function normalizeBaseUrl(url: string): string {
  const trimmed = url.trim().replace(/\/+$/, '');
  return trimmed || 'https://youmind.com';
}

function extractDomain(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function getFaviconUrl(
  faviconUrl: string | undefined,
  pageUrl: string | undefined,
): string | undefined {
  if (faviconUrl?.startsWith('http')) {
    return faviconUrl;
  }
  const domain = extractDomain(pageUrl);
  if (domain) {
    return `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;
  }
  return undefined;
}

function getTextFileIconByFileName(
  fileName?: string,
  materialType?: string,
): string {
  if (materialType === 'pdf') {
    return MATERIAL_PDF_ICON;
  }
  if (!fileName) {
    return MATERIAL_TEXT_FILE_ICON;
  }
  const extension = fileName.split('.').pop()?.toLowerCase();
  switch (extension) {
    case 'docx':
    case 'doc':
      return MATERIAL_WORD_ICON;
    case 'pptx':
    case 'ppt':
      return MATERIAL_PPT_ICON;
    case 'xlsx':
    case 'xls':
      return MATERIAL_EXCEL_ICON;
    case 'txt':
      return MATERIAL_TXT_ICON;
    case 'md':
    case 'markdown':
      return MATERIAL_MARKDOWN_ICON;
    case 'srt':
      return MATERIAL_TEXT_FILE_ICON;
    case 'pdf':
      return MATERIAL_PDF_ICON;
    default:
      return MATERIAL_TEXT_FILE_ICON;
  }
}

function getUserDisplayName(user: CurrentUserResponse | null | undefined): string | undefined {
  return user?.displayName?.trim()
    || user?.name?.trim()
    || undefined;
}

function toStoredUser(user: CurrentUserResponse | null | undefined): YouMindUser | null {
  if (!user) return null;
  return {
    id: user.id?.trim() || undefined,
    email: user.email?.trim() || undefined,
    name: getUserDisplayName(user),
    avatarUrl: user.avatarUrl?.trim() || user.avatar?.trim() || user.picture?.trim() || undefined,
  };
}

function parseNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function normalizeAuthErrorMessage(message: string | null | undefined): string {
  return message?.trim().toLowerCase() ?? '';
}

function isYouMindRefreshTokenInvalidApiError(error: unknown): boolean {
  if (!(error instanceof YouMindApiError)) return false;
  const normalizedMessage = normalizeAuthErrorMessage(error.message);
  return error.code === 'RefreshTokenInvalidException'
    || normalizedMessage.includes('refresh token invalid')
    || normalizedMessage.includes('refresh_token_already_used')
    || normalizedMessage.includes('refresh_token_not_found')
    || normalizedMessage.includes('session_expired');
}

function isYouMindUnauthorizedApiError(error: unknown): boolean {
  if (!(error instanceof YouMindApiError)) return false;
  const normalizedMessage = normalizeAuthErrorMessage(error.message);
  return error.status === 401
    || normalizedMessage.includes('unauthorized')
    || normalizedMessage.includes('jwt expired')
    || normalizedMessage.includes('invalid jwt');
}

export type YouMindAuthFailureReason = 'signed_out' | 'expired';

export function getYouMindAuthFailureReason(
  error: unknown,
  options?: { hadStoredSession?: boolean },
): YouMindAuthFailureReason | null {
  const normalizedMessage = normalizeAuthErrorMessage(error instanceof Error ? error.message : String(error ?? ''));
  if (normalizedMessage === 'you are not signed in.') {
    return options?.hadStoredSession ? 'expired' : 'signed_out';
  }
  if (isYouMindRefreshTokenInvalidApiError(error) || isYouMindUnauthorizedApiError(error)) {
    return options?.hadStoredSession === false ? 'signed_out' : 'expired';
  }
  return null;
}

function parseNullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function parseNullableDateMs(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = new Date(value).getTime();
  return Number.isFinite(parsed) ? parsed : null;
}

function normalizeProductTier(value: unknown): YouMindProductTier {
  if (value === 'pro' || value === 'max') return value;
  return 'free';
}

async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  if (typeof blob.arrayBuffer === 'function') {
    return blob.arrayBuffer();
  }

  return new Promise<ArrayBuffer>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (reader.result instanceof ArrayBuffer) {
        resolve(reader.result);
        return;
      }
      reject(new Error('Failed to read the selected attachment.'));
    };
    reader.onerror = () => {
      reject(reader.error ?? new Error('Failed to read the selected attachment.'));
    };
    reader.readAsArrayBuffer(blob);
  });
}

function createEmptyCategorySummary(): YouMindCreditCategorySummary {
  return {
    chat: 0,
    writing: 0,
    search: 0,
    image: 0,
    audio: 0,
    parsing: 0,
    video: 0,
  };
}

function mapCategorySummary(value: unknown): YouMindCreditCategorySummary {
  const source = isRecord(value) ? value : {};
  return {
    chat: parseNumber(source.chat),
    writing: parseNumber(source.writing),
    search: parseNumber(source.search),
    image: parseNumber(source.image),
    audio: parseNumber(source.audio),
    parsing: parseNumber(source.parsing),
    video: parseNumber(source.video),
  };
}

function mapDailyBreakdownItem(value: unknown): YouMindCreditDailyBreakdown | null {
  if (!isRecord(value)) return null;
  const date = trimText(value.date);
  if (!date) return null;
  return {
    date,
    chat: parseNumber(value.chat),
    writing: parseNumber(value.writing),
    search: parseNumber(value.search),
    image: parseNumber(value.image),
    audio: parseNumber(value.audio),
    parsing: parseNumber(value.parsing),
    video: parseNumber(value.video),
  };
}

function mapCurrentUser(user: CurrentUserResponse | null | undefined): YouMindCurrentUser | null {
  const id = trimText(user?.id);
  if (!id) return null;
  const subscription = user?.space?.subscription;
  const renewAtMs = parseNullableDateMs(subscription?.renewAt || subscription?.renewCycleAnchor);
  return {
    id,
    email: trimText(user?.email) || null,
    name: getUserDisplayName(user) || null,
    avatarUrl: trimText(user?.avatarUrl) || trimText(user?.avatar) || trimText(user?.picture) || null,
    timeZone: trimText(user?.timeZone) || null,
    subscription: subscription && trimText(subscription.id)
      ? {
          id: trimText(subscription.id),
          productTier: normalizeProductTier(subscription.productTier),
          provider: trimText(subscription.provider) || null,
          billingInterval: trimText(subscription.billingInterval) || null,
          renewAtMs,
          externalId: trimText(subscription.externalId) || null,
        }
      : null,
  };
}

function mapCreditAccount(value: unknown): YouMindCreditAccount | null {
  if (!isRecord(value)) return null;
  const id = trimText(value.id);
  if (!id) return null;
  return {
    id,
    spaceId: trimText(value.spaceId || value.space_id),
    monthlyBalance: parseNumber(value.monthlyBalance ?? value.monthly_balance),
    monthlyQuota: parseNumber(value.monthlyQuota ?? value.monthly_quota),
    permanentBalance: parseNumber(value.permanentBalance ?? value.permanent_balance),
    dailyBalance: parseNumber(value.dailyBalance ?? value.daily_balance),
    bonusBalance: parseNumber(value.bonusBalance ?? value.bonus_balance),
    dailyUsed: parseNumber(value.dailyUsed ?? value.daily_used),
    dailyLimit: parseNumber(value.dailyLimit ?? value.daily_limit),
    freeMonthlyDailyGrantCount: parseNullableNumber(
      value.freeMonthlyDailyGrantCount ?? value.free_monthly_daily_grant_count,
    ),
    freeMonthlyDailyGrantMax: parseNullableNumber(
      value.freeMonthlyDailyGrantMax ?? value.free_monthly_daily_grant_max,
    ),
    freeMonthlyFirstDailyGrantAtMs: parseNullableDateMs(
      value.freeMonthlyFirstDailyGrantAt ?? value.free_monthly_first_daily_grant_at,
    ),
    productTier: normalizeProductTier(value.productTier ?? value.product_tier),
    subTier: parseNumber(value.subTier ?? value.sub_tier),
    currentPeriodStartMs: parseDateMs(value.currentPeriodStart ?? value.current_period_start),
    currentPeriodEndMs: parseDateMs(value.currentPeriodEnd ?? value.current_period_end),
    refreshCycleAnchorMs: parseDateMs(value.refreshCycleAnchor ?? value.refresh_cycle_anchor),
  };
}

function mapCreditUsagePeriod(value: unknown): YouMindCreditUsagePeriod {
  const source = isRecord(value) ? value : {};
  return {
    summary: {
      totalConsumed: parseNumber(source.summary && isRecord(source.summary) ? source.summary.totalConsumed : undefined),
      byCategory: mapCategorySummary(source.summary && isRecord(source.summary) ? source.summary.byCategory : undefined),
    },
    dailyBreakdown: Array.isArray(source.dailyBreakdown)
      ? source.dailyBreakdown
          .map(mapDailyBreakdownItem)
          .filter((item: YouMindCreditDailyBreakdown | null): item is YouMindCreditDailyBreakdown => !!item)
      : [],
    currentPeriodStartMs: parseDateMs(source.currentPeriodStart),
    currentPeriodEndMs: parseDateMs(source.currentPeriodEnd),
  };
}

function mapCreditUsageLast30Days(value: unknown): YouMindCreditUsageLast30Days {
  const source = isRecord(value) ? value : {};
  return {
    summary: {
      totalConsumed: parseNumber(source.summary && isRecord(source.summary) ? source.summary.totalConsumed : undefined),
      byCategory: mapCategorySummary(source.summary && isRecord(source.summary) ? source.summary.byCategory : undefined),
    },
    dailyBreakdown: Array.isArray(source.dailyBreakdown)
      ? source.dailyBreakdown
          .map(mapDailyBreakdownItem)
          .filter((item: YouMindCreditDailyBreakdown | null): item is YouMindCreditDailyBreakdown => !!item)
      : [],
    currentPeriodStartDate: trimText(source.currentPeriodStartDate),
    currentPeriodEndDate: trimText(source.currentPeriodEndDate),
  };
}

function mapPermanentCreditGrant(value: unknown): YouMindPermanentCreditGrant | null {
  if (!isRecord(value)) return null;
  const id = trimText(value.id);
  if (!id) return null;
  return {
    id,
    amount: parseNumber(value.amount),
    reason: trimText(value.reason) || 'Credits',
    createdAtMs: parseDateMs(value.createdAt || value.created_at),
  };
}

function isRecord(value: unknown): value is Record<string, any> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function appendByPath(target: Record<string, any>, path: string, chunk: string): void {
  const tokens = path.replace(/^\./, '').split('.').filter(Boolean);
  if (tokens.length === 0) return;
  let node: Record<string, any> = target;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    const existing = node[token];
    if (!isRecord(existing)) {
      node[token] = {};
    }
    node = node[token];
  }
  const finalToken = tokens[tokens.length - 1]!;
  const prev = typeof node[finalToken] === 'string' ? node[finalToken] : '';
  node[finalToken] = `${prev}${chunk}`;
}

function getByPath(target: Record<string, any>, path: string): unknown {
  const tokens = path.replace(/^\./, '').split('.').filter(Boolean);
  if (tokens.length === 0) return target;
  let current: unknown = target;
  for (const token of tokens) {
    if (!isRecord(current) && !Array.isArray(current)) {
      return undefined;
    }
    current = (current as Record<string, any>)[token];
  }
  return current;
}

function setByPath(target: Record<string, any>, path: string, value: unknown): void {
  const tokens = path.replace(/^\./, '').split('.').filter(Boolean);
  if (tokens.length === 0) return;
  let node: Record<string, any> = target;
  for (let index = 0; index < tokens.length - 1; index += 1) {
    const token = tokens[index]!;
    const existing = node[token];
    if (!isRecord(existing)) {
      node[token] = {};
    }
    node = node[token];
  }
  node[tokens[tokens.length - 1]!] = value;
}

function parseJsonSafely<T>(value: string): T | null {
  try {
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

function mapAssistantBlock(block: any): YouMindAssistantBlock | null {
  if (!block || typeof block !== 'object') return null;
  const id = typeof block.id === 'string' ? block.id : `block_${Math.random().toString(36).slice(2, 10)}`;
  const type = trimText(block.type || block.kind);
  const status = typeof block.status === 'string' ? block.status : undefined;
  if (type === 'reasoning') {
    return {
      id,
      kind: 'reasoning',
      status,
      text: typeof block.data === 'string'
        ? block.data
        : typeof block.reasoning === 'string'
          ? block.reasoning
          : typeof block.content === 'string'
            ? block.content
            : '',
    };
  }
  if (type === 'tool') {
    const toolResponse = block.toolResponse ?? block.tool_response;
    return {
      id,
      kind: 'tool',
      status,
      toolName: trimText(block.toolName ?? block.tool_name) || 'tool',
      toolResponse: typeof toolResponse === 'string' ? toolResponse : undefined,
      toolArguments: block.toolArguments ?? block.tool_arguments,
      toolResult: block.toolResult ?? block.tool_result,
      elapsedMs: typeof block.toolExecuteElapsedMs === 'number'
        ? block.toolExecuteElapsedMs
        : typeof block.tool_execute_elapsed_ms === 'number'
          ? block.tool_execute_elapsed_ms
        : typeof block.toolGenerateElapsedMs === 'number'
          ? block.toolGenerateElapsedMs
          : typeof block.tool_generate_elapsed_ms === 'number'
            ? block.tool_generate_elapsed_ms
          : undefined,
    };
  }
  return {
    id,
    kind: 'content',
    status,
    text: typeof block.data === 'string'
      ? block.data
      : typeof block.content === 'string'
        ? block.content
        : typeof block.text === 'string'
          ? block.text
          : '',
  };
}

function normalizeStreamingCompletionBlock(block: any): any {
  if (!isRecord(block)) return block;
  if (trimText(block.type || block.kind) !== 'tool') {
    return block;
  }

  const toolResponse = block.toolResponse ?? block.tool_response;
  return {
    ...block,
    messageId: trimText(block.messageId ?? block.message_id) || undefined,
    toolName: trimText(block.toolName ?? block.tool_name) || 'tool',
    toolArguments: block.toolArguments ?? block.tool_arguments,
    toolResult: block.toolResult ?? block.tool_result,
    toolResponse: typeof toolResponse === 'string' ? toolResponse : undefined,
    toolExecuteElapsedMs: typeof block.toolExecuteElapsedMs === 'number'
      ? block.toolExecuteElapsedMs
      : typeof block.tool_execute_elapsed_ms === 'number'
        ? block.tool_execute_elapsed_ms
        : undefined,
    toolGenerateElapsedMs: typeof block.toolGenerateElapsedMs === 'number'
      ? block.toolGenerateElapsedMs
      : typeof block.tool_generate_elapsed_ms === 'number'
        ? block.tool_generate_elapsed_ms
        : undefined,
  };
}

function normalizeStreamingMessage(message: any): any {
  if (!isRecord(message)) return message;
  if (message.role !== 'assistant' || !Array.isArray(message.blocks)) {
    return message;
  }
  return {
    ...message,
    blocks: message.blocks.map((block: any) => normalizeStreamingCompletionBlock(block)),
  };
}

function normalizeCompletionBlockPath(path: string): string {
  return path
    .replace(/(^|\.)(message_id)(?=\.|$)/g, '$1messageId')
    .replace(/(^|\.)(tool_name)(?=\.|$)/g, '$1toolName')
    .replace(/(^|\.)(tool_arguments)(?=\.|$)/g, '$1toolArguments')
    .replace(/(^|\.)(tool_result)(?=\.|$)/g, '$1toolResult')
    .replace(/(^|\.)(tool_response)(?=\.|$)/g, '$1toolResponse')
    .replace(/(^|\.)(tool_execute_elapsed_ms)(?=\.|$)/g, '$1toolExecuteElapsedMs')
    .replace(/(^|\.)(tool_generate_elapsed_ms)(?=\.|$)/g, '$1toolGenerateElapsedMs');
}

function mapChatMessage(message: any, scopeId: string | null | undefined): YouMindChatMessage | null {
  if (!message || typeof message !== 'object') return null;
  const role = typeof message.role === 'string' ? message.role : '';
  const id = typeof message.id === 'string' ? message.id : `msg_${Math.random().toString(36).slice(2, 10)}`;
  const createdAtMs = typeof message.createdAt === 'string' ? new Date(message.createdAt).getTime() : Date.now();
  if (role === 'user') {
    const rawSkill = isRecord(message.skill) ? message.skill : null;
    const skillId = trimText(rawSkill?.id);
    const skillName = trimText(rawSkill?.name);
    return {
      id,
      role: 'user',
      createdAtMs,
      content: typeof message.content === 'string' ? stripMentionMarkup(message.content) : '',
      skill: skillId && skillName
        ? {
          id: skillId,
          name: skillName,
        }
        : undefined,
      attachments: getUserMessageAttachments(message, scopeId),
    };
  }
  const rawBlocks = Array.isArray(message.blocks) ? message.blocks : [];
  return {
    id,
    role: 'assistant',
    createdAtMs,
    model: typeof message.model === 'string' ? message.model : undefined,
    status: typeof message.status === 'string' ? message.status : undefined,
    blocks: rawBlocks
      .map(mapAssistantBlock)
      .filter((item: YouMindAssistantBlock | null): item is YouMindAssistantBlock => !!item),
  };
}

function mapChatAttachment(value: unknown, scopeId: string | null | undefined): YouMindChatAttachment | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  const type = trimText(record.type).toLowerCase();
  const name = trimText(record.at_name ?? record.atName ?? record.title ?? record.name ?? record.id) || 'Attachment';
  const entity = isRecord(record.entity) ? record.entity : null;
  const entityImageUrl = trimText(
    entity?.hero_image_url
    ?? entity?.heroImageUrl
    ?? entity?.image_url
    ?? entity?.imageUrl
    ?? entity?.thumbnail_url
    ?? entity?.thumbnailUrl
    ?? entity?.url,
  );
  const mobileImageUrl = trimText(record.image);
  const rememberedAttachment = resolveRememberedYouMindChatAttachment(
    scopeId,
    trimText(record.id)
    || trimText(record.material_id ?? record.materialId)
    || trimText(record.snip_id ?? record.snipId),
  );

  if (type === 'material' || type === 'snip') {
    const resolvedImageUrl = entityImageUrl || mobileImageUrl || (
      rememberedAttachment?.mimeType?.startsWith('image/') ? rememberedAttachment.url : ''
    );
    if (resolvedImageUrl) {
      return {
        kind: 'image',
        url: resolvedImageUrl,
        name: name || rememberedAttachment?.name || 'Attachment',
        mimeType: rememberedAttachment?.mimeType || 'image/*',
      };
    }
    return {
      kind: 'file',
      url: '',
      name,
      mimeType: undefined,
    };
  }

  if (type === 'inlineimage' || type === 'inline_image') {
    const url = trimText(record.image_url ?? record.imageUrl);
    if (!url) return null;
    return {
      kind: 'image',
      url,
      name,
      mimeType: 'image/*',
    };
  }

  if (type === 'file') {
    const url = trimText(record.file_url ?? record.fileUrl);
    if (!url) return null;
    const mimeType = trimText(record.mime_type ?? record.mimeType) || undefined;
    return {
      kind: mimeType?.startsWith('image/') ? 'image' : 'file',
      url,
      name,
      mimeType,
    };
  }

  return null;
}

function getUserMessageAttachments(
  message: any,
  scopeId: string | null | undefined,
): YouMindChatAttachment[] | undefined {
  const rawReferences = [
    ...(Array.isArray(message?.atReferences) ? message.atReferences : []),
    ...(Array.isArray(message?.at_references) ? message.at_references : []),
    ...(Array.isArray(message?.atReference) ? message.atReference : []),
    ...(Array.isArray(message?.mobileAtReference) ? message.mobileAtReference : []),
  ];
  const fallbackReferences = rawReferences.length > 0
    ? []
    : parseAttachmentMentionsFromContent(typeof message?.content === 'string' ? message.content : '');
  const mappedAttachments = rawReferences
    .concat(fallbackReferences)
    .map((item) => mapChatAttachment(item, scopeId))
    .filter((item: YouMindChatAttachment | null): item is YouMindChatAttachment => !!item);
  const attachments = mappedAttachments.reduce<YouMindChatAttachment[]>((acc, attachment) => {
    const existingIndex = acc.findIndex((candidate) => (
      candidate.name === attachment.name
      && (
        (candidate.url && candidate.url === attachment.url)
        || (!candidate.url && !attachment.url)
      )
    ) || (
      candidate.name === attachment.name
      && (
        candidate.kind === 'image'
        || attachment.kind === 'image'
      )
    ));

    if (existingIndex === -1) {
      acc.push(attachment);
      return acc;
    }

    const existing = acc[existingIndex]!;
    if (existing.kind !== 'image' && attachment.kind === 'image') {
      acc[existingIndex] = attachment;
    }
    return acc;
  }, []);
  return attachments.length > 0 ? attachments : undefined;
}

function parseAttachmentMentionsFromContent(content: string): Array<Record<string, string>> {
  if (!content) return [];
  const mentionPattern = /@\[@([^\]]+)\]\(id:([^;)+]+);type:([^)]+)\)/g;
  const matches: Array<Record<string, string>> = [];
  let match: RegExpExecArray | null = mentionPattern.exec(content);
  while (match) {
    const [, atName, id, type] = match;
    const normalizedType = type.trim();
    if (normalizedType === 'material' || normalizedType === 'inlineImage') {
      matches.push({
        type: normalizedType,
        id: id.trim(),
        at_name: atName.trim(),
      });
    }
    match = mentionPattern.exec(content);
  }
  return matches;
}

function stripMentionMarkup(content: string): string {
  if (!content) return '';
  return content
    .replace(/@\[@[^\]]+\]\(id:[^)]+\)/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function mapChatDetail(chat: any, scopeId: string | null | undefined): YouMindChatDetail {
  const messages = Array.isArray(chat?.messages)
    ? chat.messages
      .map((message: any) => mapChatMessage(message, scopeId))
      .filter((item: YouMindChatMessage | null): item is YouMindChatMessage => !!item)
    : [];
  return {
    id: typeof chat?.id === 'string' ? chat.id : '',
    title: typeof chat?.title === 'string' && chat.title.trim() ? chat.title : 'New chat',
    createdAtMs: typeof chat?.createdAt === 'string' ? new Date(chat.createdAt).getTime() : Date.now(),
    updatedAtMs: typeof chat?.updatedAt === 'string' ? new Date(chat.updatedAt).getTime() : Date.now(),
    messages,
  };
}

function mapSkillSummary(value: unknown): YouMindSkillSummary | null {
  if (!isRecord(value)) return null;
  const id = trimText(value.id);
  const name = trimText(value.name);
  if (!id || !name) return null;
  return {
    id,
    name,
    description: trimText(value.description),
    iconBgColor: trimText(value.icon_bg_color ?? value.iconBgColor) || null,
    iconValue: trimText(value.icon_value ?? value.iconValue) || null,
    origin: trimText(value.origin) || null,
    creatorId: trimText(value.creator_id ?? value.creatorId) || null,
  };
}

function mapSkillSummaryList(value: unknown): YouMindSkillSummary[] {
  return Array.isArray(value)
    ? value
        .map(mapSkillSummary)
        .filter((item: YouMindSkillSummary | null): item is YouMindSkillSummary => !!item)
    : [];
}

function parseDateMs(value: unknown): number {
  if (typeof value === 'string') {
    const parsed = new Date(value).getTime();
    if (Number.isFinite(parsed)) return parsed;
  }
  return Date.now();
}

function trimText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeBoardStatus(value: unknown): string {
  const raw = trimText(value).toLowerCase();
  if (raw === 'in-progress' || raw === 'active') return 'active';
  if (raw === 'other' || raw === 'archived') return 'archived';
  return raw || 'active';
}

function getBoardItemEntityId(item: any): string {
  return trimText(item?.entity?.id)
    || trimText(item?.snipId)
    || trimText(item?.thoughtId)
    || trimText(item?.boardGroupId)
    || trimText(item?.chatId)
    || trimText(item?.id);
}

function getBoardItemTitle(item: any): string {
  const entity = item?.entity;
  return trimText(entity?.title)
    || trimText(entity?.name)
    || trimText(entity?.webpage?.title)
    || trimText(entity?.fileName)
    || trimText(entity?.description)
    || trimText(entity?.id)
    || 'Untitled';
}

function getBoardItemSubtitle(item: any): string {
  const entityType = trimText(item?.entityType || item?.entity_type);
  const entityClass = trimText(item?.entity?.$class);
  if (entityType === 'thought') return 'Note';
  if (entityType === 'board_group') return 'Group';
  if (entityType === 'chat') return 'Chat';
  if (entityClass.endsWith('Dto')) {
    return entityClass.replace(/Dto$/, '').replace(/([a-z0-9])([A-Z])/g, '$1 $2') || 'Material';
  }
  return 'Material';
}

function getBoardItemDetailPath(item: any): string | null {
  const entityType = trimText(item?.entityType || item?.entity_type);
  const entityId = getBoardItemEntityId(item);
  if (!entityId) return null;
  if (entityType === 'thought') return `/thoughts/${entityId}`;
  if (entityType === 'chat') return `/chats/${entityId}`;
  if (entityType === 'board_group') return null;
  return `/snips/${entityId}/simplified`;
}

function getBoardItemCard(item: any, title: string): YouMindBoardEntryCard {
  const entityType = trimText(item?.entityType || item?.entity_type);
  const entity = item?.entity;
  if (entityType === 'board_group') {
    return {
      variant: 'group',
      title,
      description: trimText(entity?.description) || null,
    };
  }
  if (entityType === 'thought') {
    return {
      variant: 'note',
      title,
      description: trimText(entity?.excerpt || entity?.summary || entity?.plainText || entity?.text) || null,
      imageUrl: trimText(entity?.coverImage || entity?.cover_image) || null,
    };
  }
  if (entityType === 'chat') {
    return {
      variant: 'chat',
      title,
      description: trimText(entity?.latestMessage || entity?.summary) || null,
    };
  }

  const materialType = trimText(entity?.type);
  const fileUrl = trimText(entity?.file?.url || entity?.file?.storage_url);
  const fileName = trimText(entity?.file?.name);
  const imageWidth = parseNullableNumber(
    entity?.file?.width
    ?? entity?.file?.image_width
    ?? entity?.width
    ?? entity?.image_width
    ?? entity?.metadata?.width,
  );
  const imageHeight = parseNullableNumber(
    entity?.file?.height
    ?? entity?.file?.image_height
    ?? entity?.height
    ?? entity?.image_height
    ?? entity?.metadata?.height,
  );
  const imageAspectRatio = imageWidth && imageHeight && imageWidth > 0 && imageHeight > 0
    ? imageWidth / imageHeight
    : null;
  const pageUrl = trimText(entity?.webpage?.url);
  const faviconUrl = getFaviconUrl(trimText(entity?.webpage?.site?.favicon_url), pageUrl) || null;
  const heroImageUrl = trimText(entity?.hero_image_url || entity?.heroImageUrl || entity?.webpage?.hero_image_url) || null;
  const description = trimText(entity?.webpage?.description || entity?.summary || entity?.description) || null;

  if (materialType === 'image') {
    return {
      variant: 'image',
      title,
      imageUrl: fileUrl || IMAGE_ICON,
      description,
      aspectRatio: imageAspectRatio,
    };
  }
  if (materialType === 'pdf' || materialType === 'office' || materialType === 'text-file') {
    return {
      variant: 'file',
      title,
      subtitle: fileName || null,
      imageUrl: getTextFileIconByFileName(fileName || undefined, materialType || undefined),
    };
  }
  if (materialType === 'voice' || materialType === 'video' || materialType === 'snippet') {
    return {
      variant: materialType === 'video' ? 'article' : 'file',
      title,
      description,
      imageUrl: materialType === 'video' ? heroImageUrl || VIDEO_ICON : materialType === 'voice' ? AUDIO_ICON : SNIPPET_ICON,
      faviconUrl,
      subtitle: trimText(entity?.webpage?.site?.name) || trimText(entity?.site?.name) || null,
    };
  }

  return {
    variant: 'article',
    title,
    subtitle: trimText(entity?.webpage?.site?.name) || trimText(entity?.site?.name) || null,
    description,
    imageUrl: heroImageUrl,
    faviconUrl,
  };
}

function getBoardItemIcon(item: any): YouMindBoardEntryIcon {
  const entityType = trimText(item?.entityType || item?.entity_type);
  const entity = item?.entity;
  if (entityType === 'board_group') {
    return {
      kind: 'group',
      color: trimText(entity?.icon?.color) || null,
    };
  }
  if (entityType === 'thought') {
    return {
      kind: 'image',
      url: THOUGHT_ICON,
    };
  }
  if (entityType === 'chat') {
    return {
      kind: 'image',
      url: CHAT_ICON,
    };
  }

  const materialType = trimText(entity?.type);
  const fileUrl = trimText(entity?.file?.url || entity?.file?.storage_url);
  const fileName = trimText(entity?.file?.name);
  const pageUrl = trimText(entity?.webpage?.url);
  const faviconUrl = getFaviconUrl(trimText(entity?.webpage?.site?.favicon_url), pageUrl);

  if (materialType === 'pdf' || materialType === 'office' || materialType === 'text-file') {
    return {
      kind: 'image',
      url: getTextFileIconByFileName(fileName || undefined, materialType || undefined),
    };
  }
  if (materialType === 'image') {
    return {
      kind: 'image',
      url: fileUrl || IMAGE_ICON,
      fallbackUrl: IMAGE_ICON,
    };
  }
  if (materialType === 'voice') {
    return {
      kind: 'image',
      url: AUDIO_ICON,
    };
  }
  if (materialType === 'video') {
    return {
      kind: 'image',
      url: VIDEO_ICON,
    };
  }
  if (materialType === 'snippet') {
    return {
      kind: 'image',
      url: SNIPPET_ICON,
    };
  }

  return {
    kind: 'image',
    url: faviconUrl || WEBSITE_ICON,
    fallbackUrl: WEBSITE_ICON,
  };
}

function mapBoardItemNode(
  item: any,
  sourceIndex: number,
  groupItemIdByEntityId: Map<string, string>,
): YouMindBoardListNode | null {
  const entityId = getBoardItemEntityId(item);
  if (!entityId) return null;
  const boardItemId = trimText(item?.id) || entityId;
  const entityType = trimText(item?.entityType || item?.entity_type);
  const materialType = trimText(item?.entity?.type);
  const kind: YouMindBoardEntryKind = entityType === 'board_group'
    ? 'group'
    : entityType === 'chat'
      ? 'chat'
      : 'material';
  const title = getBoardItemTitle(item);
  const rawParentGroupId = trimText(item?.parentBoardGroupId || item?.parent_board_group_id) || null;
  return {
    id: boardItemId,
    parentId: rawParentGroupId ? (groupItemIdByEntityId.get(rawParentGroupId) || null) : null,
    rank: trimText(item?.rank) || entityId,
    updatedAtMs: parseDateMs(item?.updatedAt || item?.updated_at || item?.entity?.updatedAt || item?.entity?.updated_at),
    sourceIndex,
    entry: {
      id: entityId,
      kind,
      section: 'materials',
      filterType: kind === 'group'
        ? 'group'
        : entityType === 'thought'
          ? 'note'
          : entityType === 'chat'
            ? 'chat'
            : materialType === 'image'
              ? 'image'
              : materialType === 'pdf'
                ? 'pdf'
                : materialType === 'office'
                  ? 'office'
                  : materialType === 'text-file'
                    ? 'text-file'
                    : materialType === 'voice'
                      ? 'audio'
                      : materialType === 'video'
                        ? 'video'
                        : materialType === 'snippet'
                          ? 'snippet'
                          : 'article',
      icon: getBoardItemIcon(item),
      card: getBoardItemCard(item, title),
      title,
      subtitle: getBoardItemSubtitle(item),
      rank: trimText(item?.rank) || entityId,
      updatedAtMs: parseDateMs(item?.updatedAt || item?.updated_at || item?.entity?.updatedAt || item?.entity?.updated_at),
      detailPath: getBoardItemDetailPath(item),
      detailTitle: title,
    },
  };
}

function getCraftTitle(craft: any): string {
  return trimText(craft?.title)
    || trimText(craft?.metadata?.title)
    || trimText(craft?.id)
    || 'Untitled';
}

function getCraftSubtitle(craft: any): string {
  const craftType = trimText(craft?.type);
  if (!craftType) return 'Craft';
  return craftType
    .replace(/-/g, ' ')
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function getCraftIcon(craft: any): YouMindBoardEntryIcon {
  const craftType = trimText(craft?.type);
  switch (craftType) {
    case 'audio-pod':
      return { kind: 'audio-pod' };
    case 'webpage':
      return { kind: 'webpage' };
    case 'slides':
      return { kind: 'slides' };
    case 'canvas':
      return { kind: 'canvas' };
    case 'memory':
      return { kind: 'memory' };
    case 'craft-group':
      return {
        kind: 'group',
        color: trimText(craft?.icon?.color) || null,
      };
    case 'page':
    default:
      return { kind: 'document' };
  }
}

function getCraftCard(craft: any, title: string): YouMindBoardEntryCard {
  const craftType = trimText(craft?.type);
  switch (craftType) {
    case 'craft-group':
      return {
        variant: 'group',
        title,
        description: trimText(craft?.description) || null,
      };
    case 'audio-pod':
      return {
        variant: 'audio-pod',
        title,
        imageUrl: trimText(craft?.album_cover_url || craft?.albumCoverUrl) || null,
        description: trimText(craft?.summary || craft?.metadata?.summary) || null,
      };
    case 'webpage':
      return {
        variant: 'webpage',
        title,
        imageUrl: trimText(craft?.screenshot) || null,
        description: trimText(craft?.metadata?.description || craft?.summary) || null,
      };
    case 'slides':
      return {
        variant: 'slides',
        title,
        imageUrl: trimText(craft?.cover_image || craft?.style?.cover_image) || null,
        backdropUrl: trimText(craft?.style?.backdrop) || null,
      };
    case 'canvas':
      return {
        variant: 'canvas',
        title,
        imageUrl: trimText(craft?.cover_image || craft?.screenshot) || null,
      };
    case 'memory':
      return {
        variant: 'memory',
        title,
        imageUrl: trimText(craft?.style?.cover_image) || null,
        backdropUrl: trimText(craft?.style?.backdrop) || null,
      };
    case 'page':
    default:
      return {
        variant: 'page',
        title,
        imageUrl: trimText(craft?.style?.cover_image) || null,
        backdropUrl: trimText(craft?.style?.backdrop) || null,
        description: trimText(craft?.summary || craft?.metadata?.summary) || null,
      };
  }
}

function mapCraftNode(craft: any): YouMindBoardListNode | null {
  const id = trimText(craft?.id);
  if (!id) return null;
  const title = getCraftTitle(craft);
  const craftType = trimText(craft?.type);
  return {
    id,
    parentId: trimText(craft?.parentCraftGroupId || craft?.parent_craft_group_id) || null,
    rank: trimText(craft?.rank) || id,
    updatedAtMs: parseDateMs(craft?.updatedAt || craft?.updated_at),
    sourceIndex: Number.MAX_SAFE_INTEGER,
    entry: {
      id,
      kind: craftType === 'craft-group' ? 'group' : 'craft',
      section: 'crafts',
      filterType: craftType === 'craft-group'
        ? 'group'
        : craftType === 'audio-pod'
          ? 'audio-pod'
          : craftType === 'webpage'
            ? 'webpage'
            : craftType === 'slides'
              ? 'slides'
              : craftType === 'canvas'
                ? 'canvas'
                : craftType === 'memory'
                  ? 'memory'
                  : 'page',
      icon: getCraftIcon(craft),
      card: getCraftCard(craft, title),
      title,
      subtitle: getCraftSubtitle(craft),
      rank: trimText(craft?.rank) || id,
      updatedAtMs: parseDateMs(craft?.updatedAt || craft?.updated_at),
      detailPath: craftType === 'craft-group' ? null : `/crafts/${id}`,
      detailTitle: title,
    },
  };
}

function flattenBoardTree(
  nodes: YouMindBoardListNode[],
  sortNodes: (left: YouMindBoardListNode, right: YouMindBoardListNode) => number,
): YouMindBoardEntry[] {
  const byParent = new Map<string | null, YouMindBoardListNode[]>();
  for (const node of nodes) {
    const bucket = byParent.get(node.parentId) ?? [];
    bucket.push(node);
    byParent.set(node.parentId, bucket);
  }
  for (const bucket of byParent.values()) {
    bucket.sort(sortNodes);
  }
  const seen = new Set<string>();
  const result: YouMindBoardEntry[] = [];

  const visit = (parentId: string | null, depth: number) => {
    const children = byParent.get(parentId) ?? [];
    for (const child of children) {
      if (seen.has(child.id)) continue;
      seen.add(child.id);
      result.push({
        ...child.entry,
        depth,
      });
      visit(child.id, depth + 1);
    }
  };

  visit(null, 0);
  const leftovers = nodes.filter((node) => !seen.has(node.id));
  leftovers.sort(sortNodes);
  for (const node of leftovers) {
    result.push({
      ...node.entry,
      depth: 0,
    });
    visit(node.id, 1);
  }
  return result;
}

function compareNodesByRank(left: YouMindBoardListNode, right: YouMindBoardListNode): number {
  return left.rank.localeCompare(right.rank);
}

function compareNodesBySourceIndex(left: YouMindBoardListNode, right: YouMindBoardListNode): number {
  const delta = left.sourceIndex - right.sourceIndex;
  if (delta !== 0) return delta;
  return compareNodesByRank(left, right);
}

function mapBoardSummary(board: any): YouMindBoardSummary | null {
  const id = trimText(board?.id);
  if (!id) return null;
  const materialCount = typeof board?.snipsCount === 'number'
    ? board.snipsCount + (typeof board?.thoughtsCount === 'number' ? board.thoughtsCount : 0)
    : (typeof board?.snips_count === 'number' ? board.snips_count : 0)
      + (typeof board?.thoughts_count === 'number' ? board.thoughts_count : 0);
  const craftCount = typeof board?.craftsCount === 'number'
    ? board.craftsCount
    : typeof board?.crafts_count === 'number'
      ? board.crafts_count
      : 0;
  return {
    id,
    name: trimText(board?.name) || 'Untitled board',
    description: trimText(board?.description),
    status: normalizeBoardStatus(board?.status),
    type: trimText(board?.type) || 'normal',
    isFavorited: Boolean(board?.isFavorited ?? board?.is_favorited),
    icon: {
      name: trimText(board?.icon?.name),
      color: trimText(board?.icon?.color),
    },
    updatedAtMs: parseDateMs(board?.updatedAt || board?.updated_at),
    createdAtMs: parseDateMs(board?.createdAt || board?.created_at),
    materialCount,
    craftCount,
    totalCount: materialCount + craftCount,
    heroImageUrls: Array.isArray(board?.heroImageUrls)
      ? board.heroImageUrls.filter((item: unknown): item is string => typeof item === 'string')
      : Array.isArray(board?.hero_image_urls)
        ? board.hero_image_urls.filter((item: unknown): item is string => typeof item === 'string')
        : [],
  };
}

export function buildYouMindWebCookieHeader(accessToken: string): string {
  return `YOUMIND_MOBILE_AUTH=${encodeURIComponent(accessToken)}`;
}

export function buildYouMindWebCookieScript(baseUrl: string, accessToken: string): string {
  let domain = '';
  try {
    domain = new URL(normalizeBaseUrl(baseUrl)).hostname;
  } catch {
    domain = 'youmind.com';
  }
  return `
    (function() {
      var cookie = 'YOUMIND_MOBILE_AUTH=${encodeURIComponent(accessToken)}; path=/; domain=${domain}; SameSite=Lax';
      document.cookie = cookie;
    })();
    true;
  `;
}

function buildChatOrigin(boardId: string) {
  return { type: 'board' as const, id: boardId };
}

function transformToYouMindThumbnailUrl(url: string, size: 'small' | 'large' | 'chat' = 'small'): string {
  if (
    !url
    || url.endsWith(`@${size}`)
    || (!url.startsWith('https://cdn.gooo.ai/')
      && !url.includes('youmind-user-files-private')
      && !url.includes('youmind-internet-files-public'))
  ) {
    return url;
  }

  try {
    const normalizedUrl = url.replace(/\.(png|jpg|jpeg|gif|webp|svg)$/i, '');
    const urlObject = new URL(normalizedUrl);
    const key = urlObject.pathname.split('/').slice(-2).join('/');
    return `https://cdn.gooo.ai/${key}@${size}`;
  } catch {
    return url;
  }
}

async function waitForYouMindThumbnailReady(
  url: string,
  signal?: AbortSignal,
  timeoutMs = 10_000,
): Promise<boolean> {
  const pollIntervalMs = 2_000;
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (signal?.aborted) {
      return false;
    }
    try {
      const response = await fetch(url, {
        method: 'HEAD',
        signal,
      });
      if (response.ok) {
        return true;
      }
    } catch {
      // Keep polling until timeout.
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }

  return false;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((value) => value.toString(16).padStart(2, '0'))
    .join('');
}

function randomHex(numBytes: number): string {
  const bytes = new Uint8Array(numBytes);
  if (!globalThis.crypto?.getRandomValues) {
    throw new Error('Secure random generator unavailable');
  }
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function encodeRfc3986UriComponent(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function getPercentEncodedPath(path: string): string {
  return path
    .split('/')
    .map((segment) => {
      try {
        return encodeRfc3986UriComponent(decodeURIComponent(segment));
      } catch {
        return encodeRfc3986UriComponent(segment);
      }
    })
    .join('/');
}

function getYouMindRunningEnvironment(): string {
  if (__DEV__ || Constants.appOwnership === 'expo') {
    return 'Development';
  }
  return 'AppStore';
}

function getYouMindUserAgent(): string {
  const appVersion = Application.nativeApplicationVersion?.trim() || '1.0.0';
  const bundleVersion = Application.nativeBuildVersion?.trim();
  const deviceName = Device.deviceName?.trim() || Device.modelName?.trim() || 'Clawket';
  const systemName = Device.osName?.trim()
    || (Platform.OS === 'android' ? 'Android' : 'iOS');
  const systemVersion = Device.osVersion?.trim() || '0';
  const detailComponents = [
    deviceName,
    `${systemName} ${systemVersion}`,
    ...(bundleVersion ? [`Build ${bundleVersion}`] : []),
    getYouMindRunningEnvironment(),
  ];
  return `YouMind/${appVersion} (${detailComponents.join('; ')})`;
}

async function getYouMindDeviceId(): Promise<string> {
  const existing = await StorageService.getYouMindDeviceId();
  if (existing) return existing;
  const created = randomHex(16);
  await StorageService.setYouMindDeviceId(created);
  return created;
}

function buildYouMindHmacHeaders(path: string, method: 'GET' | 'POST', bodyText?: string): Record<string, string> {
  const appSecret = publicYouMindAuthConfig.appSecret?.trim();
  if (!appSecret) {
    throw new Error('YouMind app secret is not configured. Set EXPO_PUBLIC_YOUMIND_APP_SECRET.');
  }
  const timestamp = Date.now().toString();
  const nonce = randomHex(YOUMIND_NONCE_BYTES);
  const messageParts = [
    method,
    getPercentEncodedPath(path),
    timestamp,
    nonce,
  ];
  if (bodyText && bodyText.length > 0) {
    messageParts.push(sha256(bodyText));
  }
  const signature = sha256.hmac(appSecret, messageParts.join('\n'));
  return {
    'x-app-id': YOUMIND_APP_ID,
    'x-timestamp': timestamp,
    'x-nonce': nonce,
    'x-signature': signature,
  };
}

function parseSseEvent(rawEvent: string): CompletionChunk[] {
  const normalized = rawEvent.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  const dataLines = normalized
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());
  if (dataLines.length === 0) return [];
  const payload = dataLines.join('\n');
  if (!payload || payload === '[DONE]') return [];
  const parsed = parseJsonSafely<CompletionChunk>(payload);
  return parsed ? [parsed] : [];
}

function drainSseBuffer(buffer: string): { chunks: CompletionChunk[]; rest: string } {
  const normalized = buffer.replace(/\r\n/g, '\n');
  const chunks: CompletionChunk[] = [];
  let cursor = 0;

  while (true) {
    const boundary = normalized.indexOf('\n\n', cursor);
    if (boundary < 0) {
      return { chunks, rest: normalized.slice(cursor) };
    }
    chunks.push(...parseSseEvent(normalized.slice(cursor, boundary)));
    cursor = boundary + 2;
  }
}

function createAbortError(): Error {
  const error = new Error('Request aborted');
  error.name = 'AbortError';
  return error;
}

function buildRequestHeaders(deviceId: string, options: RequestOptions): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    'Content-Type': 'application/json',
    'x-time-zone': Intl.DateTimeFormat().resolvedOptions().timeZone,
    'x-use-camel-case': 'true',
    'x-client-type': Platform.OS === 'android' ? 'mobile_android' : 'mobile_ios',
    'x-device-id': deviceId,
    'User-Agent': getYouMindUserAgent(),
  };
  if (options.accessToken) {
    headers.Authorization = `Bearer ${options.accessToken}`;
  }
  if (options.extraHeaders) {
    Object.assign(headers, options.extraHeaders);
  }
  return headers;
}

function createAsyncQueue<T>() {
  const values: T[] = [];
  const waiters: Array<{ resolve: (result: IteratorResult<T>) => void; reject: (error: unknown) => void }> = [];
  let done = false;
  let failure: unknown = null;

  const flush = () => {
    while (waiters.length > 0) {
      if (failure) {
        const waiter = waiters.shift()!;
        waiter.reject(failure);
        continue;
      }
      if (values.length > 0) {
        const waiter = waiters.shift()!;
        waiter.resolve({ value: values.shift()!, done: false });
        continue;
      }
      if (done) {
        const waiter = waiters.shift()!;
        waiter.resolve({ value: undefined as T, done: true });
        continue;
      }
      break;
    }
  };

  return {
    push(value: T) {
      if (done || failure) return;
      values.push(value);
      flush();
    },
    end() {
      if (done || failure) return;
      done = true;
      flush();
    },
    fail(error: unknown) {
      if (done || failure) return;
      failure = error;
      flush();
    },
    async *iterate(): AsyncGenerator<T> {
      while (true) {
        const result = await new Promise<IteratorResult<T>>((resolve, reject) => {
          waiters.push({ resolve, reject });
          flush();
        });
        if (result.done) return;
        yield result.value;
      }
    },
  };
}

export class YouMindClient {
  private readonly baseUrl: string;
  private readonly authScopeKey: string | null;
  private refreshPromise: Promise<YouMindAuthSession | null> | null = null;
  private defaultBoardPromise: Promise<YouMindBoardResponse> | null = null;

  constructor(baseUrl: string, options?: { authScopeKey?: string | null }) {
    this.baseUrl = normalizeBaseUrl(baseUrl);
    this.authScopeKey = options?.authScopeKey?.trim() || null;
  }

  // Stable identity for per-account caches; matches the auth-session scope so
  // attachment metadata cannot leak across accounts on the same baseUrl.
  get cacheScopeId(): string {
    return `${this.baseUrl}::${this.authScopeKey ?? ''}`;
  }

  private async request<T>(path: string, options: RequestOptions = {}): Promise<T> {
    const deviceId = await getYouMindDeviceId();
    const headers = buildRequestHeaders(deviceId, options);
    const bodyText = options.bodyText ?? (options.body === undefined ? undefined : JSON.stringify(options.body));

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'POST',
      headers,
      body: bodyText,
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const payload = parseJsonSafely<{ message?: string; code?: string; error?: { message?: string; code?: string } }>(text);
      const message = payload?.message || payload?.error?.message || response.statusText || 'Request failed.';
      throw new YouMindApiError(message, {
        status: response.status,
        code: payload?.code || payload?.error?.code || null,
      });
    }

    const text = await response.text().catch(() => '');
    return parseYouMindSuccessPayload<T>(text);
  }

  private async requestText(path: string, options: RequestOptions = {}): Promise<string> {
    const deviceId = await getYouMindDeviceId();
    const headers = buildRequestHeaders(deviceId, options);
    const bodyText = options.bodyText ?? (options.body === undefined ? undefined : JSON.stringify(options.body));

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: options.method ?? 'POST',
      headers,
      body: bodyText,
      signal: options.signal,
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      const payload = parseJsonSafely<{ message?: string; code?: string; error?: { message?: string; code?: string } }>(text);
      const message = payload?.message || payload?.error?.message || response.statusText || 'Request failed.';
      throw new YouMindApiError(message, {
        status: response.status,
        code: payload?.code || payload?.error?.code || null,
      });
    }

    return response.text();
  }

  private async streamRequest(path: string, options: RequestOptions = {}): Promise<AsyncGenerator<CompletionChunk>> {
    const deviceId = await getYouMindDeviceId();
    const headers = buildRequestHeaders(deviceId, {
      ...options,
      extraHeaders: {
        Accept: 'text/event-stream',
        ...(options.extraHeaders ?? {}),
      },
    });
    const bodyText = options.bodyText ?? (options.body === undefined ? undefined : JSON.stringify(options.body));
    const queue = createAsyncQueue<CompletionChunk>();

    const stream = async function* (): AsyncGenerator<CompletionChunk> {
      yield* queue.iterate();
    };

    const xhr = new XMLHttpRequest();
    let processedLength = 0;
    let buffer = '';
    let settled = false;

    const cleanup = () => {
      if (options.signal) {
        options.signal.removeEventListener('abort', handleAbort);
      }
    };

    const settleFailure = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      queue.fail(error);
    };

    const settleSuccess = () => {
      if (settled) return;
      settled = true;
      cleanup();
      if (buffer.trim()) {
        const finalChunks = parseSseEvent(buffer);
        finalChunks.forEach((chunk) => queue.push(chunk));
      }
      queue.end();
    };

    const consumeText = (text: string) => {
      if (!text) return;
      buffer += text;
      const drained = drainSseBuffer(buffer);
      buffer = drained.rest;
      drained.chunks.forEach((chunk) => queue.push(chunk));
    };

    const handleAbort = () => {
      xhr.abort();
      settleFailure(createAbortError());
    };

    xhr.open(options.method ?? 'POST', `${this.baseUrl}${path}`, true);
    Object.entries(headers).forEach(([name, value]) => {
      xhr.setRequestHeader(name, value);
    });

    xhr.onprogress = () => {
      const nextText = xhr.responseText.slice(processedLength);
      processedLength = xhr.responseText.length;
      consumeText(nextText);
    };

    xhr.onload = () => {
      const nextText = xhr.responseText.slice(processedLength);
      processedLength = xhr.responseText.length;
      consumeText(nextText);
      if (xhr.status >= 200 && xhr.status < 300) {
        settleSuccess();
        return;
      }
      const payload = parseJsonSafely<{ message?: string; code?: string; error?: { message?: string; code?: string } }>(xhr.responseText);
      settleFailure(new YouMindApiError(payload?.message || payload?.error?.message || xhr.statusText || 'Request failed.', {
        status: xhr.status,
        code: payload?.code || payload?.error?.code || null,
      }));
    };

    xhr.onerror = () => {
      settleFailure(new Error('YouMind streaming request failed.'));
    };

    xhr.onabort = () => {
      settleFailure(createAbortError());
    };

    if (options.signal) {
      if (options.signal.aborted) {
        handleAbort();
        return stream();
      }
      options.signal.addEventListener('abort', handleAbort);
    }

    xhr.send(bodyText);
    return stream();
  }

  async sendOtp(email: string): Promise<void> {
    const body = {
      email: email.trim(),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    };
    const bodyText = JSON.stringify(body);
    await this.request('/api/v1/auth/signInWithOTP', {
      body,
      bodyText,
      extraHeaders: buildYouMindHmacHeaders('/api/v1/auth/signInWithOTP', 'POST', bodyText),
    });
  }

  async verifyOtp(email: string, code: string): Promise<YouMindAuthSession> {
    const digits = code.trim().split('').filter(Boolean);
    const response = await this.request<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user?: CurrentUserResponse | null;
    }>('/api/v1/auth/mobile/validateOTPToken', {
      body: {
        formData: {
          email: email.trim(),
          token: digits,
        },
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });

    const session: YouMindAuthSession = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresIn: response.expiresIn,
      createdAtMs: Date.now(),
      user: toStoredUser(response.user),
    };
    await StorageService.setYouMindAuthSession(this.baseUrl, session, this.authScopeKey);
    return session;
  }

  async signInWithIdToken(params: {
    provider: YouMindIdTokenProvider;
    credential: string;
    nonce?: string;
  }): Promise<YouMindAuthSession> {
    const response = await this.request<{
      accessToken: string;
      refreshToken: string;
      expiresIn: number;
      user?: CurrentUserResponse | null;
    }>('/api/v1/auth/mobile/signInWithIdToken', {
      body: {
        provider: params.provider,
        credential: params.credential,
        nonce: params.nonce,
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      },
    });

    const session: YouMindAuthSession = {
      accessToken: response.accessToken,
      refreshToken: response.refreshToken,
      expiresIn: response.expiresIn,
      createdAtMs: Date.now(),
      user: toStoredUser(response.user),
    };
    await StorageService.setYouMindAuthSession(this.baseUrl, session, this.authScopeKey);
    return session;
  }

  async getStoredSession(): Promise<YouMindAuthSession | null> {
    return StorageService.getYouMindAuthSession(this.baseUrl, this.authScopeKey);
  }

  async clearSession(): Promise<void> {
    await StorageService.clearYouMindAuthSession(this.baseUrl, this.authScopeKey);
  }

  private shouldRefresh(session: YouMindAuthSession): boolean {
    const expirationMs = session.createdAtMs + session.expiresIn * 1000;
    const remainingMs = expirationMs - Date.now();
    const thresholdMs = Math.max(REFRESH_THRESHOLD_MIN_MS, session.expiresIn * 1000 * REFRESH_THRESHOLD_RATIO);
    return remainingMs <= thresholdMs;
  }

  async refreshSessionIfNeeded(force = false): Promise<YouMindAuthSession | null> {
    const stored = await this.getStoredSession();
    if (!stored) return null;
    if (!force && !this.shouldRefresh(stored)) return stored;
    if (this.refreshPromise) return this.refreshPromise;

    this.refreshPromise = (async () => {
      try {
        const response = await this.request<{
          accessToken: string;
          refreshToken: string;
          expiresIn: number;
          user?: CurrentUserResponse | null;
        }>('/api/v1/auth/mobile/refreshToken', {
          body: { refreshToken: stored.refreshToken },
        });
        const next: YouMindAuthSession = {
          accessToken: response.accessToken,
          refreshToken: response.refreshToken,
          expiresIn: response.expiresIn,
          createdAtMs: Date.now(),
          user: toStoredUser(response.user) ?? stored.user ?? null,
        };
        await StorageService.setYouMindAuthSession(this.baseUrl, next, this.authScopeKey);
        return next;
      } catch (error) {
        if (getYouMindAuthFailureReason(error, { hadStoredSession: true }) === 'expired') {
          await this.clearSession();
          throw error;
        }
        return stored;
      } finally {
        this.refreshPromise = null;
      }
    })();

    return this.refreshPromise;
  }

  async getValidSession(): Promise<YouMindAuthSession | null> {
    return this.refreshSessionIfNeeded(false);
  }

  async getCurrentUser(): Promise<YouMindCurrentUser | null> {
    const session = await this.getValidSession();
    if (!session) return null;
    const user = await this.request<CurrentUserResponse>('/api/v1/getCurrentUser', {
      accessToken: session.accessToken,
    });
    const nextSession: YouMindAuthSession = {
      ...session,
      user: toStoredUser(user),
    };
    await StorageService.setYouMindAuthSession(this.baseUrl, nextSession, this.authScopeKey);
    return mapCurrentUser(user);
  }

  async getCreditAccount(): Promise<YouMindCreditAccount | null> {
    const session = await this.getValidSession();
    if (!session) return null;
    const response = await this.request<unknown>('/api/v1/credit/getCreditAccount', {
      accessToken: session.accessToken,
    });
    return mapCreditAccount(response);
  }

  async listCreditsConsumeTransactionsInCurrentPeriod(): Promise<YouMindCreditUsagePeriod> {
    const session = await this.getValidSession();
    if (!session) {
      return {
        summary: {
          totalConsumed: 0,
          byCategory: createEmptyCategorySummary(),
        },
        dailyBreakdown: [],
        currentPeriodStartMs: Date.now(),
        currentPeriodEndMs: Date.now(),
      };
    }
    const response = await this.request<unknown>('/api/v1/credit/listCreditsConsumeTransactionsInCurrentPeriod', {
      accessToken: session.accessToken,
    });
    return mapCreditUsagePeriod(response);
  }

  async listCreditsConsumeTransactionsInLast30Days(): Promise<YouMindCreditUsageLast30Days> {
    const session = await this.getValidSession();
    if (!session) {
      return {
        summary: {
          totalConsumed: 0,
          byCategory: createEmptyCategorySummary(),
        },
        dailyBreakdown: [],
        currentPeriodStartDate: '',
        currentPeriodEndDate: '',
      };
    }
    const response = await this.request<unknown>('/api/v1/credit/listCreditsConsumeTransactionsInLast30Days', {
      accessToken: session.accessToken,
    });
    return mapCreditUsageLast30Days(response);
  }

  async listPermanentCreditGrants(params?: {
    current?: number;
    pageSize?: number;
  }): Promise<YouMindPermanentCreditGrantPage> {
    const session = await this.getValidSession();
    if (!session) {
      return { data: [], paging: null };
    }
    const response = await this.request<{
      data?: unknown[];
      paging?: {
        current?: number;
        pageSize?: number;
        total?: number;
      } | null;
    }>('/api/v1/credit/listPermanentCreditGrants', {
      accessToken: session.accessToken,
      body: {
        current: params?.current ?? 0,
        pageSize: params?.pageSize ?? 10,
      },
    });
    return {
      data: Array.isArray(response.data)
        ? response.data
            .map(mapPermanentCreditGrant)
            .filter((item: YouMindPermanentCreditGrant | null): item is YouMindPermanentCreditGrant => !!item)
        : [],
      paging: response.paging
        ? {
            current: parseNumber(response.paging.current),
            pageSize: parseNumber(response.paging.pageSize),
            total: parseNumber(response.paging.total),
          }
        : null,
    };
  }

  async signOut(): Promise<void> {
    const session = await this.getStoredSession();
    if (session?.accessToken) {
      try {
        await this.request('/api/v1/logOut', {
          accessToken: session.accessToken,
        });
      } catch {
        // Ignore logout errors and still clear local state.
      }
    }
    await this.clearSession();
    this.defaultBoardPromise = null;
  }

  async getDefaultBoard(forceRefresh = false): Promise<YouMindBoardResponse> {
    if (!forceRefresh && this.defaultBoardPromise) {
      return this.defaultBoardPromise;
    }
    this.defaultBoardPromise = (async () => {
      const session = await this.getValidSession();
      if (!session) {
        throw new Error('You are not signed in.');
      }
      const board = await this.request<YouMindBoardResponse>('/api/v1/board/getDefaultBoard', {
        accessToken: session.accessToken,
        body: {},
      });
      if (!board?.id) {
        throw new Error('Unable to load your default YouMind board.');
      }
      return board;
    })();
    try {
      return await this.defaultBoardPromise;
    } catch (error) {
      this.defaultBoardPromise = null;
      throw error;
    }
  }

  async listChats(): Promise<YouMindChatSummary[]> {
    const session = await this.getValidSession();
    if (!session) return [];
    const response = await this.request<{
      data?: Array<any>;
    }>('/api/v2/chatAssistant/listChatHistory', {
      accessToken: session.accessToken,
      body: {
        current: 0,
        pageSize: 100,
      },
    });
    return (response.data ?? []).map((item) => ({
      id: typeof item.id === 'string' ? item.id : '',
      title: typeof item.title === 'string' && item.title.trim() ? item.title : 'New chat',
      updatedAtMs: typeof item.updatedAt === 'string' ? new Date(item.updatedAt).getTime() : Date.now(),
      createdAtMs: typeof item.createdAt === 'string' ? new Date(item.createdAt).getTime() : Date.now(),
    })).filter((item) => !!item.id);
  }

  async listBoards(): Promise<YouMindBoardSummary[]> {
    const session = await this.getValidSession();
    if (!session) return [];
    const response = await this.request<any[]>('/api/v1/listBoards', {
      accessToken: session.accessToken,
      body: {
        withFavorite: true,
      },
    });
    return response
      .map(mapBoardSummary)
      .filter((item: YouMindBoardSummary | null): item is YouMindBoardSummary => !!item)
      .sort((left, right) => {
        if (left.status !== right.status) {
          if (left.status === 'active') return -1;
          if (right.status === 'active') return 1;
        }
        return right.updatedAtMs - left.updatedAtMs;
      });
  }

  async getBoardDetail(boardId: string): Promise<YouMindBoardDetail> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }
    const [boardResponse, craftsResponse] = await Promise.all([
      this.request<YouMindBoardDetailResponse>('/api/v1/board/getBoardDetail', {
        accessToken: session.accessToken,
        body: { id: boardId },
      }),
      this.request<any[]>('/api/v1/listCrafts', {
        accessToken: session.accessToken,
        body: { boardId },
      }),
    ]);
    const boardItems = Array.isArray(boardResponse?.boardItems)
      ? boardResponse.boardItems
      : Array.isArray(boardResponse?.board_items)
        ? boardResponse.board_items
        : [];
    const craftMap = new Map<string, any>();
    for (const craft of Array.isArray(craftsResponse) ? craftsResponse : []) {
      const id = trimText(craft?.id);
      if (id) craftMap.set(id, craft);
    }
    const groupItemIdByEntityId = new Map<string, string>();
    boardItems.forEach((item) => {
      const entityType = trimText(item?.entityType || item?.entity_type);
      const entityId = getBoardItemEntityId(item);
      const boardItemId = trimText(item?.id);
      if (entityType === 'board_group' && entityId && boardItemId) {
        groupItemIdByEntityId.set(entityId, boardItemId);
      }
    });
    const materialNodes = boardItems
      .map((item, index) => mapBoardItemNode(item, index, groupItemIdByEntityId))
      .filter((item: YouMindBoardListNode | null): item is YouMindBoardListNode => !!item);
    const craftNodes = Array.from(craftMap.values())
      .map(mapCraftNode)
      .filter((item: YouMindBoardListNode | null): item is YouMindBoardListNode => !!item);
    const entries = flattenBoardTree([
      ...materialNodes,
      ...craftNodes,
    ], compareNodesBySourceIndex);
    const materials = flattenBoardTree(materialNodes, compareNodesBySourceIndex);
    const crafts = flattenBoardTree(craftNodes, compareNodesByRank);
    return {
      id: trimText(boardResponse?.id) || boardId,
      name: trimText(boardResponse?.name) || 'Untitled board',
      description: trimText(boardResponse?.description),
      updatedAtMs: parseDateMs(boardResponse?.updatedAt),
      createdAtMs: parseDateMs(boardResponse?.createdAt),
      entries,
      materials,
      crafts,
    };
  }

  async getChat(chatId: string): Promise<YouMindChatDetail> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }
    const response = await this.request<any>('/api/v2/chatAssistant/getChatDetail', {
      accessToken: session.accessToken,
      body: { chatId },
    });
    return mapChatDetail(response, this.cacheScopeId);
  }

  async getPackSkills(packId: string): Promise<YouMindSkillSummary[]> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }
    const response = await this.request<YouMindPackResponse>(`/api/v1/packGallery/getPack/${encodeURIComponent(packId)}`, {
      accessToken: session.accessToken,
      body: {
        locale: i18n.language,
      },
    });
    return Array.isArray(response.skills)
      ? response.skills
          .map(mapSkillSummary)
          .filter((item: YouMindSkillSummary | null): item is YouMindSkillSummary => !!item)
      : [];
  }

  async listInstalledSkills(): Promise<YouMindInstalledSkills> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }
    const response = await this.request<YouMindInstalledSkillsResponse>('/api/v1/skill/listInstalledSkills', {
      accessToken: session.accessToken,
      body: {
        locale: i18n.language,
      },
    });
    return {
      all: mapSkillSummaryList(response.all),
      pinned: mapSkillSummaryList(response.pinned),
      mySkills: mapSkillSummaryList(response.my_skills),
      installed: mapSkillSummaryList(response.installed),
    };
  }

  async deleteChat(chatId: string): Promise<void> {
    const session = await this.getValidSession();
    if (!session) return;
    await this.request('/api/v2/chatAssistant/deleteChat', {
      accessToken: session.accessToken,
      body: { chatId },
    });
  }

  async updateChatTitle(chatId: string, title: string): Promise<void> {
    const session = await this.getValidSession();
    if (!session) return;
    await this.request('/api/v2/chatAssistant/updateChatTitle', {
      accessToken: session.accessToken,
      body: { chatId, title },
    });
  }

  async abortMessage(chatId: string): Promise<void> {
    const session = await this.getValidSession();
    if (!session) return;
    await this.request('/api/v2/chatAssistant/abortMessage', {
      accessToken: session.accessToken,
      body: { chatId },
    });
  }

  async streamCreateChat(
    message: string,
    skill?: YouMindChatSkill | null,
    atReferences: YouMindChatAttachmentReference[] = [],
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<CompletionChunk>> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }
    const defaultBoard = await this.getDefaultBoard();
    return this.streamRequest('/api/v2/chatAssistant/createChat', {
      accessToken: session.accessToken,
      body: {
        boardId: defaultBoard.id,
        board_id: defaultBoard.id,
        message,
        messageMode: YOUMIND_MESSAGE_MODE_AGENT,
        message_mode: YOUMIND_MESSAGE_MODE_AGENT,
        skill: skill ?? undefined,
        at_references: atReferences.length > 0 ? atReferences : undefined,
        origin: buildChatOrigin(defaultBoard.id),
      },
      signal,
    });
  }

  async streamSendMessage(
    chatId: string,
    message: string,
    skill?: YouMindChatSkill | null,
    atReferences: YouMindChatAttachmentReference[] = [],
    signal?: AbortSignal,
  ): Promise<AsyncGenerator<CompletionChunk>> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }
    const defaultBoard = await this.getDefaultBoard();
    return this.streamRequest('/api/v2/chatAssistant/sendMessage', {
      accessToken: session.accessToken,
      body: {
        chatId,
        chat_id: chatId,
        boardId: defaultBoard.id,
        board_id: defaultBoard.id,
        message,
        messageMode: YOUMIND_MESSAGE_MODE_AGENT,
        message_mode: YOUMIND_MESSAGE_MODE_AGENT,
        skill: skill ?? undefined,
        at_references: atReferences.length > 0 ? atReferences : undefined,
        origin: buildChatOrigin(defaultBoard.id),
      },
      signal,
    });
  }

  async createMaterialByUrl(boardId: string, url: string): Promise<YouMindMaterialCreateResponse> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }

    return this.request<YouMindMaterialCreateResponse>('/api/v1/tryCreateSnipByUrl', {
      accessToken: session.accessToken,
      body: {
        boardId,
        url: url.trim(),
      },
    });
  }

  private async uploadPrivateFile(
    uri: string,
    mimeType?: string,
    isPublic = false,
    signal?: AbortSignal,
  ): Promise<{ hash: string; size: number }> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }

    const fileResponse = await fetch(uri, { signal });
    if (!fileResponse.ok) {
      throw new Error('Failed to read the selected attachment.');
    }
    const fileBlob = await fileResponse.blob();
    const buffer = await blobToArrayBuffer(fileBlob);
    const hash = sha256(new Uint8Array(buffer));
    const signedUrl = (await this.requestText('/api/v1/genSignedPutUrlIfNotExist', {
      accessToken: session.accessToken,
      body: {
        hash,
        isPublic,
      },
      signal,
    })).trim();

    if (!signedUrl) {
      return { hash, size: fileBlob.size };
    }

    const uploadResponse = await fetch(signedUrl, {
      method: 'PUT',
      headers: mimeType ? { 'Content-Type': mimeType } : undefined,
      body: fileBlob,
      signal,
    });

    if (!uploadResponse.ok) {
      throw new Error('Failed to upload the selected attachment.');
    }

    return { hash, size: fileBlob.size };
  }

  private async createFileRecordFromCdnUrl(params: {
    cdnUrl: string;
    name: string;
    hash: string;
    mimeType?: string;
    size?: number;
    needExtract?: boolean;
    signal?: AbortSignal;
  }): Promise<void> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }
    await this.requestText('/api/v1/createFileRecordFromCdnUrl', {
      accessToken: session.accessToken,
      body: {
        cdnUrl: params.cdnUrl,
        name: params.name,
        hash: params.hash,
        mimeType: params.mimeType,
        size: params.size,
        needExtract: params.needExtract,
      },
      signal: params.signal,
    });
  }

  private getChatAttachmentName(uri: string, fileName?: string): string {
    const trimmed = fileName?.trim();
    if (trimmed) return trimmed;
    const pathSegment = uri.split(/[?#]/, 1)[0]?.split('/').pop()?.trim();
    if (!pathSegment) return 'attachment';
    try {
      return decodeURIComponent(pathSegment);
    } catch {
      return pathSegment;
    }
  }

  private async createMaterialFromUploadedFile(params: {
    hash: string;
    fileName: string;
    mimeType: string;
    boardId: string;
    signal?: AbortSignal;
  }): Promise<YouMindMaterialCreateResponse> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }

    const normalizedMimeType = params.mimeType.trim().toLowerCase();
    const lowerFileName = params.fileName.trim().toLowerCase();
    const file = { name: params.fileName, hash: params.hash };

    if (normalizedMimeType.startsWith('image/')) {
      const thumbnailUrl = transformToYouMindThumbnailUrl(
        `https://cdn.gooo.ai/user-files/${params.hash}`,
        'chat',
      );
      await waitForYouMindThumbnailReady(thumbnailUrl, params.signal);
      return this.request<YouMindMaterialCreateResponse>('/api/v1/createImage', {
        accessToken: session.accessToken,
        body: {
          file,
          board_id: params.boardId,
          title: params.fileName,
        },
        signal: params.signal,
      });
    }

    if (normalizedMimeType.startsWith('audio/')) {
      return this.request<YouMindMaterialCreateResponse>('/api/v1/createVoice', {
        accessToken: session.accessToken,
        body: {
          file,
          board_id: params.boardId,
        },
        signal: params.signal,
      });
    }

    if (normalizedMimeType.startsWith('video/')) {
      return this.request<YouMindMaterialCreateResponse>('/api/v1/createVideo', {
        accessToken: session.accessToken,
        body: {
          file,
          board_id: params.boardId,
        },
        signal: params.signal,
      });
    }

    if (normalizedMimeType === 'application/pdf' || lowerFileName.endsWith('.pdf')) {
      return this.request<YouMindMaterialCreateResponse>('/api/v1/createPDF', {
        accessToken: session.accessToken,
        body: {
          file,
          board_id: params.boardId,
          sync_transcribe: true,
        },
        signal: params.signal,
      });
    }

    const officeMimeTypes = new Set([
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/msword',
      'application/vnd.ms-powerpoint',
      'application/vnd.ms-excel',
    ]);

    if (
      officeMimeTypes.has(normalizedMimeType)
      || lowerFileName.endsWith('.doc')
      || lowerFileName.endsWith('.docx')
      || lowerFileName.endsWith('.ppt')
      || lowerFileName.endsWith('.pptx')
      || lowerFileName.endsWith('.xls')
      || lowerFileName.endsWith('.xlsx')
    ) {
      return this.request<YouMindMaterialCreateResponse>('/api/v1/createOffice', {
        accessToken: session.accessToken,
        body: {
          file,
          board_id: params.boardId,
          sync_transcribe: true,
        },
        signal: params.signal,
      });
    }

    return this.request<YouMindMaterialCreateResponse>('/api/v1/createTextFile', {
      accessToken: session.accessToken,
      body: {
        file,
        board_id: params.boardId,
        file_type: params.mimeType,
      },
      signal: params.signal,
    });
  }

  async prepareChatAttachment(
    attachment: YouMindPendingChatAttachment,
    signal?: AbortSignal,
  ): Promise<YouMindChatAttachmentReference> {
    const normalizedMimeType = attachment.mimeType?.trim() || 'application/octet-stream';
    const { hash, size } = await this.uploadPrivateFile(
      attachment.uri,
      normalizedMimeType,
      false,
      signal,
    );
    const cdnUrl = `https://cdn.gooo.ai/user-files/${hash}`;
    const name = this.getChatAttachmentName(attachment.uri, attachment.fileName);
    const defaultBoard = await this.getDefaultBoard();

    await this.createFileRecordFromCdnUrl({
      cdnUrl,
      name,
      hash,
      mimeType: normalizedMimeType,
      size,
      needExtract: true,
      signal,
    });

    const material = await this.createMaterialFromUploadedFile({
      hash,
      fileName: name,
      mimeType: normalizedMimeType,
      boardId: defaultBoard.id,
      signal,
    });
    const materialId = material.id?.trim();

    if (!materialId) {
      throw new Error('Failed to create the selected attachment in YouMind.');
    }

    return {
      type: 'material',
      id: materialId,
      entity_type: 'snip',
      from: 'user',
      at_name: name,
    };
  }

  async prepareChatAttachments(
    attachments: YouMindPendingChatAttachment[],
    signal?: AbortSignal,
  ): Promise<YouMindChatAttachmentReference[]> {
    if (attachments.length === 0) return [];
    return Promise.all(
      attachments.map((attachment) => this.prepareChatAttachment(attachment, signal)),
    );
  }

  async createImageMaterial(params: {
    boardId: string;
    uri: string;
    mimeType?: string;
    fileName?: string;
  }): Promise<YouMindMaterialCreateResponse> {
    const session = await this.getValidSession();
    if (!session) {
      throw new Error('You are not signed in.');
    }

    const { hash } = await this.uploadPrivateFile(params.uri, params.mimeType, false);
    return this.request<YouMindMaterialCreateResponse>('/api/v1/createImage', {
      accessToken: session.accessToken,
      body: {
        boardId: params.boardId,
        file: {
          name: params.fileName ?? '',
          hash,
          isPublic: false,
        },
      },
    });
  }
}

export function applyYouMindChunk(draft: Record<string, any>, chunk: CompletionChunk): void {
  const messages = Array.isArray(draft.messages) ? draft.messages : [];
  const findMessageById = (messageId: string) => messages.find((item) => isRecord(item) && item.id === messageId);
  const findLastAssistantMessage = () => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index];
      if (isRecord(message) && message.role === 'assistant') {
        return message;
      }
    }
    return null;
  };
  const findBlockById = (blockId: string) => {
    for (const message of messages) {
      if (!isRecord(message) || !Array.isArray(message.blocks)) continue;
      const block = message.blocks.find((item: any) => isRecord(item) && item.id === blockId);
      if (block) return block;
    }
    return null;
  };

  if (chunk.mode === 'insert') {
    if (chunk.dataType === 'Chat' || chunk.dataType === 'ChatDetail') {
      Object.assign(draft, chunk.data);
      return;
    }
    if (chunk.dataType === 'Message') {
      const nextMessages = [...messages];
      const nextMessage = normalizeStreamingMessage(chunk.data);
      const existingIndex = nextMessages.findIndex((item) => item?.id === nextMessage?.id);
      if (existingIndex >= 0) {
        nextMessages[existingIndex] = {
          ...nextMessages[existingIndex],
          ...nextMessage,
        };
      } else if (
        nextMessage?.role === 'assistant'
        && nextMessages.length > 0
        && typeof nextMessages[nextMessages.length - 1]?.id === 'string'
        && nextMessages[nextMessages.length - 1].id.startsWith(YOUMIND_LOCAL_ASSISTANT_PLACEHOLDER_PREFIX)
      ) {
        nextMessages[nextMessages.length - 1] = {
          ...nextMessages[nextMessages.length - 1],
          ...nextMessage,
          blocks: Array.isArray(nextMessages[nextMessages.length - 1]?.blocks)
            && (!Array.isArray(nextMessage?.blocks) || nextMessage.blocks.length === 0)
            ? nextMessages[nextMessages.length - 1].blocks
            : nextMessage?.blocks,
        };
      } else {
        nextMessages.push(nextMessage);
      }
      draft.messages = nextMessages;
      return;
    }
    if (chunk.dataType === 'CompletionBlock') {
      const nextBlock = normalizeStreamingCompletionBlock(chunk.data);
      const messageId = nextBlock?.messageId ?? nextBlock?.message_id;
      const targetMessage = typeof messageId === 'string'
        ? findMessageById(messageId) ?? findLastAssistantMessage()
        : findLastAssistantMessage();
      if (!targetMessage) return;
      if (!Array.isArray(targetMessage.blocks)) {
        targetMessage.blocks = [];
      }
      const existingBlockIndex = targetMessage.blocks.findIndex((item: any) => item?.id === nextBlock?.id);
      if (existingBlockIndex >= 0) {
        targetMessage.blocks[existingBlockIndex] = {
          ...targetMessage.blocks[existingBlockIndex],
          ...nextBlock,
        };
      } else {
        targetMessage.blocks.push(nextBlock);
      }
    }
    return;
  }

  if (chunk.mode === 'replace') {
    if (chunk.targetType === 'Chat') {
      setByPath(draft, chunk.path, chunk.data);
      return;
    }
    if (chunk.targetType === 'Message') {
      const target = findMessageById(chunk.targetId);
      if (target) {
        setByPath(target, chunk.path, chunk.data);
      }
      return;
    }
    if (chunk.targetType === 'CompletionBlock') {
      const target = findBlockById(chunk.targetId);
      if (target) {
        setByPath(target, normalizeCompletionBlockPath(chunk.path), chunk.data);
      }
    }
    return;
  }

  if (chunk.mode === 'append_string') {
    if (chunk.targetType === 'Message') {
      const target = findMessageById(chunk.targetId);
      if (target) {
        appendByPath(target, chunk.path, chunk.data);
      }
      return;
    }
    if (chunk.targetType === 'CompletionBlock') {
      const target = findBlockById(chunk.targetId);
      if (target) {
        appendByPath(target, normalizeCompletionBlockPath(chunk.path), chunk.data);
      }
    }
    return;
  }

  if (chunk.mode === 'append_json') {
    const normalizedPath = chunk.targetType === 'CompletionBlock'
      ? normalizeCompletionBlockPath(chunk.path)
      : chunk.path;
    const target = chunk.targetType === 'Message'
      ? findMessageById(chunk.targetId)
      : chunk.targetType === 'CompletionBlock'
        ? findBlockById(chunk.targetId)
        : null;
    if (!target) return;
    const rawStringKey = `raw_string_of_${normalizedPath}`;
    const previous = typeof target[rawStringKey] === 'string' ? target[rawStringKey] : '';
    const nextRawString = previous + chunk.data;
    target[rawStringKey] = nextRawString;
    const parsed = parseJsonSafely<any>(nextRawString);
    if (parsed !== null) {
      setByPath(target, normalizedPath, parsed);
    }
  }
}

export function mapYouMindChatDetail(
  detail: Record<string, any>,
  scopeId: string | null | undefined,
): YouMindChatDetail {
  return mapChatDetail(detail, scopeId);
}
import { resolveRememberedYouMindChatAttachment } from './youmind-chat-attachment-cache';
