import type { AgentFileOperations, AgentFileSummary } from '@clawket/agent-protocol';
import {
  canEditAgentFile,
  canSaveAgentFile,
  filterAgentFiles,
  formatFileSize,
} from './files-model';

const files: AgentFileSummary[] = [
  { name: 'notes.md', path: '/notes.md', missing: false, size: 2_048 },
  { name: 'AGENTS.md', path: '/AGENTS.md', missing: false, size: 512 },
  { name: 'SOUL.md', path: '/SOUL.md', missing: false },
];
const operations = { set: jest.fn() } as AgentFileOperations;

describe('Agent files model', () => {
  it('orders core files first and filters by name or path', () => {
    expect(filterAgentFiles(files, '').map((file) => file.name))
      .toEqual(['SOUL.md', 'AGENTS.md', 'notes.md']);
    expect(filterAgentFiles(files, 'notes')).toEqual([files[0]]);
  });

  it('formats valid sizes', () => {
    expect(formatFileSize(512)).toBe('512 B');
    expect(formatFileSize(2_048)).toBe('2.0 KB');
    expect(formatFileSize(-1)).toBeUndefined();
  });

  it('gates editing and save attempts on capability, operation, online state, and changes', () => {
    expect(canEditAgentFile({ fileEdit: true }, operations)).toBe(true);
    expect(canEditAgentFile({ fileEdit: false }, operations)).toBe(false);
    expect(canSaveAgentFile({
      capabilities: { fileEdit: true },
      operations,
      online: true,
      changed: true,
    })).toBe(true);
    expect(canSaveAgentFile({
      capabilities: { fileEdit: false },
      operations,
      online: true,
      changed: true,
    })).toBe(false);
  });
});
