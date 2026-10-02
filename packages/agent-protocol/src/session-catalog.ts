import type { SessionDescriptor } from './descriptors';

/** Negotiated by health.sessionCatalogSync === 1, independently of product capabilities. */
export interface SessionCatalogRevision { epoch: string; revision: string }

export type SessionCatalogSyncRequest =
  | { base?: SessionCatalogRevision; page?: never; pageIndex?: true }
  | { page: SessionCatalogRevision & { offset: number }; base?: never; pageIndex?: never };

/** Full and delta payloads are at most 64 KiB of serialized UTF-8 JSON. */
export type SessionCatalogSyncResponse =
  | (SessionCatalogRevision & {
      kind: 'full'; offset: number; total: number;
      sessions: SessionDescriptor[]; nextOffset: number | null;
      /** Requested only after health.sessionCatalogPageIndex === 1; first-page continuation offsets. */
      pageOffsets?: number[];
    })
  | (SessionCatalogRevision & { kind: 'unchanged' })
  | (SessionCatalogRevision & {
      kind: 'delta'; baseRevision: string;
      upserts: SessionDescriptor[]; removedKeys: string[]; order: string[];
    })
  | { kind: 'expired'; epoch: string };
