import { CAPABILITY_MATRIX, type AgentAdapter, type AgentDescriptor } from '@clawket/agent-protocol';
import { agentFileDocument, skillSourceDocument, formatSkillDocumentMarkdown } from './document-model';

it('renders frontmatter as source while preserving its text and Markdown body', () => {
  const source = '---\nname: weather\ndescription: "``` example"\n---\n\n# Forecast\n';
  expect(formatSkillDocumentMarkdown(source)).toBe('````yaml\n---\nname: weather\ndescription: "``` example"\n---\n````\n\n\n# Forecast\n');
  expect(formatSkillDocumentMarkdown('# Title\n\n---\nBody')).toBe('# Title\n\n---\nBody');
  expect(formatSkillDocumentMarkdown('---\nname: unfinished')).toBe('---\nname: unfinished');
});

const mockAgentFileActivity = jest.fn();
jest.mock('../../services/analytics/events', () => ({
  ...jest.requireActual('../../services/analytics/events'),
  analyticsEvents: { agentFileActivity: (...args: unknown[]) => mockAgentFileActivity(...args) },
}));

const agent: AgentDescriptor = {
  connectionId: 'studio', agentId: 'main', name: 'Main', isMain: true, mainSessionKey: 'agent:main:main',
};

function adapterWith(patch: Partial<AgentAdapter>, backend: 'openclaw' | 'hermes' = 'openclaw'): AgentAdapter {
  return {
    connection: { backendKind: backend },
    capabilities: { ...CAPABILITY_MATRIX[backend] },
    ...patch,
  } as AgentAdapter;
}

describe('document sources', () => {
  beforeEach(() => mockAgentFileActivity.mockClear());

  it.each(['openclaw', 'hermes'] as const)('reads, writes and reports a %s workspace file through the adapter', async (backend) => {
    const get = jest.fn(async () => ({ name: 'MEMORY.md', path: '/MEMORY.md', missing: false, content: '# Memory', size: 8, updatedAtMs: 1_700_000_000_000 }));
    const set = jest.fn(async () => ({ ok: true }));
    const source = agentFileDocument(adapterWith({ management: { agents: { files: { get, set } } } }, backend), agent, 'MEMORY.md');
    expect(source?.key).toBe('studio:main:file:MEMORY.md');
    await expect(source!.load()).resolves.toEqual({ content: '# Memory', editable: true, missing: false, size: 8, updatedAtMs: 1_700_000_000_000 });
    expect(get).toHaveBeenCalledWith('MEMORY.md', 'main');
    await expect(source!.save!('# Updated')).resolves.toEqual({ ok: true });
    expect(set).toHaveBeenCalledWith('MEMORY.md', '# Updated', 'main');
    source!.onActivity?.('saved');
    // Telemetry carries the bounded document label, never the file name.
    expect(mockAgentFileActivity).toHaveBeenCalledWith({ action: 'saved', backend, document: 'memory' });
  });

  it('maps a missing file to an empty creatable document and drops writes without the capability', async () => {
    const get = jest.fn(async () => ({ name: 'MEMORY.md', path: '/MEMORY.md', missing: true }));
    const set = jest.fn();
    const creatable = agentFileDocument(adapterWith({ management: { agents: { files: { get, set } } } }), agent, 'MEMORY.md');
    await expect(creatable!.load()).resolves.toEqual({ content: '', editable: true, missing: true });
    expect(creatable!.save).toBeDefined();

    const readOnly = agentFileDocument(adapterWith({
      capabilities: { ...CAPABILITY_MATRIX.openclaw, fileEdit: false },
      management: { agents: { files: { get, set } } },
    }), agent, 'MEMORY.md');
    await expect(readOnly!.load()).resolves.toMatchObject({ editable: false });
    expect(readOnly!.save).toBeUndefined();
    expect(agentFileDocument(adapterWith({ management: { agents: { files: { set } } } }), agent, 'MEMORY.md')).toBeNull();
  });

  it.each(['openclaw', 'hermes'] as const)('opens linked files read-only on %s without exposing a main-document save', backend => {
    const get = jest.fn(async () => ({ skillKey: 'builder', name: 'Builder', path: '',
      content: 'print("hello")', editable: true, linkedFiles: { scripts: ['scripts/run.py'] } }));
    const updateContent = jest.fn();
    const source = skillSourceDocument(adapterWith({ connection: { ...adapterWith({}).connection, backendKind: backend },
      management: { skills: { get, updateContent } } }), 'main', 'builder', 'scripts/run.py');
    expect(source?.save).toBeUndefined();
    return expect(source!.load()).resolves.toMatchObject({ editable: false, plainText: true });
  });

  it('reads a skill document with its name and gates writes on eligibility, binary content and the update operation', async () => {
    const get = jest.fn(async () => ({ skillKey: 'builder', name: 'Builder', path: '/SKILL.md', content: '# Builder', editable: true, linkedFiles: {} }));
    const updateContent = jest.fn(async () => ({ ok: true, skillKey: 'builder', path: '/SKILL.md' }));
    const source = skillSourceDocument(adapterWith({ management: { skills: { get, updateContent } } }), 'main', 'builder');
    expect(source?.key).toBe(`${adapterWith({}).connection.id}:main:skill:builder`);
    await expect(source!.load()).resolves.toEqual({ content: '# Builder', editable: true, subtitle: 'Builder', linkedFiles: [] });
    expect(get).toHaveBeenCalledWith('builder', { agentId: 'main' });
    await source!.save!('# Changed');
    expect(updateContent).toHaveBeenCalledWith('builder', '# Changed', 'main');
    expect(source!.onActivity).toBeUndefined();

    const binary = skillSourceDocument(adapterWith({ management: { skills: {
      get: jest.fn(async () => ({ skillKey: 'builder', name: 'Builder', path: '', content: 'blob', editable: true, isBinary: true, linkedFiles: {} })),
      updateContent,
    } } }), 'main', 'builder');
    await expect(binary!.load()).resolves.toMatchObject({ editable: false, binary: true });
    const noWrite = skillSourceDocument(adapterWith({ management: { skills: { get } } }), 'main', 'builder');
    await expect(noWrite!.load()).resolves.toMatchObject({ editable: false });
    expect(noWrite!.save).toBeUndefined();
    expect(skillSourceDocument(adapterWith({ management: { skills: { updateContent } } }), 'main', 'builder')).toBeNull();
  });
});
