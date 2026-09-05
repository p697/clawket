export type MessageUsage = {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
  totalTokens?: number;
};

export type ImageMeta = { uri: string; width: number; height: number };

export type ToolPresentation =
  | {
    kind: 'image-gallery';
    imageUris: string[];
    originalImageUris?: string[];
  };

/** Lightweight non-image attachment metadata safe for UI and local chat cache. */
export type UiFileAttachment = {
  mimeType: string;
  fileName?: string;
  uri?: string;
};

export type UiApprovalStatus = 'pending' | 'allowed' | 'denied' | 'expired';

export type UiApproval =
  | {
    /** Optional for compatibility with approval cards restored from the pre-3.0 cache. */
    kind?: 'exec';
    id: string;
    command: string;
    cwd?: string;
    host?: string;
    expiresAtMs: number;
    status: UiApprovalStatus;
  }
  | {
    kind: 'pair';
    id: string;
    target: 'device' | 'node';
    displayName: string | null;
    platform: string | null;
    receivedAtMs: number;
    status: UiApprovalStatus;
    resolving?: boolean;
    resolutionError?: boolean;
  };

export type UiMessage = {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  text: string;
  userSkill?: {
    id: string;
    name: string;
  };
  idempotencyKey?: string;
  timestampMs?: number;
  streaming?: boolean;
  imageUris?: string[];
  imageMetas?: ImageMeta[];
  fileAttachments?: UiFileAttachment[];
  modelLabel?: string;
  usage?: MessageUsage;
  toolName?: string;
  toolStatus?: 'running' | 'success' | 'error';
  toolSummary?: string;
  toolArgs?: string;
  toolDetail?: string;
  toolDurationMs?: number;
  toolStartedAt?: number;
  toolFinishedAt?: number;
  toolPresentation?: ToolPresentation[];
  approval?: UiApproval;
};

export type PendingImage = {
  uri: string;
  base64: string;
  mimeType: string;
  fileName?: string;
  width?: number;
  height?: number;
};

export type PendingAttachment = {
  uri: string;
  base64: string;
  mimeType: string;
  fileName?: string;
  /** 'image' for photos, 'file' for documents */
  kind: 'image' | 'file';
};
