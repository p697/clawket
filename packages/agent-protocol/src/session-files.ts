/** Opaque, short-lived handles for files referenced by a conversation; no host paths. */
export type SessionFile = Readonly<{ id: string; name: string; size: number; mimeType: string }>;
export type SessionFileChunk = Readonly<{ offset: number; total: number; data: string; done: boolean }>;
export interface SessionFilesOperations {
  list(sessionKey: string): Promise<{ files: SessionFile[] }>;
  read(sessionKey: string, id: string, offset: number): Promise<SessionFileChunk>;
}
