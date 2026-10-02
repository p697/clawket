import {
  formatToolActivity,
  formatToolDisplayName,
  formatToolOneLiner,
  formatToolOneLinerLocalized,
  resolveToolDetail,
  resolveToolTitle,
  stripToolStatusPrefix,
  unwrapShellCommand,
  unwrapToolCall,
} from './tool-display';

describe('resolveToolTitle', () => {
  it('reads what the Agent says a call is for: a Codex js title, a Claude Code description', () => {
    expect(resolveToolTitle(JSON.stringify({ code: 'await cua.getState();', title: '查看当前浏览器页面' }))).toBe('查看当前浏览器页面');
    expect(resolveToolTitle({ command: 'npm test', description: 'Run the unit tests' })).toBe('Run the unit tests');
    expect(resolveToolTitle({ summary: '  Status\n check  ' })).toBe('Status check');
    expect(resolveToolTitle({ title: ' ', description: 'Second choice' })).toBe('Second choice');
  });

  it('keeps one line and stays absent for inputs without one', () => {
    const long = resolveToolTitle({ title: 'x'.repeat(200) });
    expect(long).toHaveLength(120);
    expect(long?.endsWith('…')).toBe(true);
    expect(resolveToolTitle({ command: 'git status' })).toBeUndefined();
    expect(resolveToolTitle({ title: 42 })).toBeUndefined();
    expect(resolveToolTitle('not json')).toBeUndefined();
    expect(resolveToolTitle('["title"]')).toBeUndefined();
    expect(resolveToolTitle(undefined)).toBeUndefined();
  });
});

describe('unwrapToolCall', () => {
  it('reads OpenClaw\'s generic tool_call wrapper as the tool it carries', () => {
    expect(unwrapToolCall('tool_call', '{"id":"exec","args":{"command":"ls -A"}}'))
      .toEqual({ name: 'exec', args: '{"command":"ls -A"}' });
    expect(unwrapToolCall('Tool_Call', '{"id":" read "}')).toEqual({ name: 'read', args: undefined });
  });

  it('keeps other tools and malformed wrappers as recorded', () => {
    expect(unwrapToolCall('exec', '{"command":"pwd"}')).toEqual({ name: 'exec', args: '{"command":"pwd"}' });
    expect(unwrapToolCall('tool_call', 'not json')).toEqual({ name: 'tool_call', args: 'not json' });
    expect(unwrapToolCall('tool_call', '{"args":{}}')).toEqual({ name: 'tool_call', args: '{"args":{}}' });
    expect(unwrapToolCall('tool_call')).toEqual({ name: 'tool_call', args: undefined });
  });
});

describe('formatToolActivity', () => {
  const t = (key: string, options?: Record<string, unknown>) => {
    if (!options) return key;
    return key.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, token: string) => String(options[token] ?? ''));
  };

  it('maps exec/bash to running command', () => {
    expect(formatToolActivity('exec', t)).toBe('Running command');
    expect(formatToolActivity('bash', t)).toBe('Running command');
    expect(formatToolActivity('Bash', t)).toBe('Running command');
  });

  it('labels other backends\' command and file tools by what they do', () => {
    expect(formatToolActivity('terminal', t)).toBe('Running command');
    expect(formatToolActivity('local_shell', t)).toBe('Running command');
    expect(formatToolActivity('mcp__fs__read_file', t)).toBe('Reading file');
    expect(formatToolActivity('MultiEdit', t)).toBe('Writing file');
  });

  it('maps read to reading file', () => {
    expect(formatToolActivity('read', t)).toBe('Reading file');
    expect(formatToolActivity('Read', t)).toBe('Reading file');
  });

  it('maps write/edit to writing file', () => {
    expect(formatToolActivity('write', t)).toBe('Writing file');
    expect(formatToolActivity('edit', t)).toBe('Writing file');
  });

  it('maps web_search to searching web', () => {
    expect(formatToolActivity('web_search', t)).toBe('Searching web');
  });

  it('maps web_fetch to web fetching', () => {
    expect(formatToolActivity('web_fetch', t)).toBe('Web fetching');
  });

  it('maps browser to browsing', () => {
    expect(formatToolActivity('browser', t)).toBe('Browsing');
  });

  it('maps message to messaging', () => {
    expect(formatToolActivity('message', t)).toBe('Messaging');
  });

  it('falls back to using {{toolName}} for unknown tools', () => {
    expect(formatToolActivity('custom_tool', t)).toBe('Using custom_tool');
    expect(formatToolActivity('my_special_tool', t)).toBe('Using my_special_tool');
  });
});

describe('formatToolOneLiner', () => {
  it('replaces underscores with spaces in tool name', () => {
    expect(formatToolOneLiner('web_search')).toBe('web search');
    expect(formatToolOneLiner('my_long_tool')).toBe('my long tool');
  });

  it('returns name only when no args', () => {
    expect(formatToolOneLiner('exec')).toBe('exec');
    expect(formatToolOneLiner('exec', undefined)).toBe('exec');
    expect(formatToolOneLiner('exec', null)).toBe('exec');
  });

  it('returns name only when args is not an object', () => {
    expect(formatToolOneLiner('exec', 'string')).toBe('exec');
    expect(formatToolOneLiner('exec', 42)).toBe('exec');
  });

  it('extracts command for exec/bash tools', () => {
    expect(formatToolOneLiner('exec', { command: 'ls -la' })).toBe('exec ls -la');
    expect(formatToolOneLiner('Bash', { command: 'git status' })).toBe('Bash git status');
  });

  it('extracts path for read/write/edit tools', () => {
    expect(formatToolOneLiner('read', { path: '/tmp/file.txt' })).toBe('read /tmp/file.txt');
    expect(formatToolOneLiner('Write', { file_path: '/tmp/out.txt' })).toBe('Write /tmp/out.txt');
    expect(formatToolOneLiner('edit', { file_path: '/tmp/f.ts' })).toBe('edit /tmp/f.ts');
  });

  it('extracts query for web_search', () => {
    expect(formatToolOneLiner('web_search', { query: 'react native' })).toBe('web search react native');
  });

  it('extracts url for web_fetch', () => {
    expect(formatToolOneLiner('web_fetch', { url: 'https://example.com' })).toBe('web fetch https://example.com');
  });

  it('extracts action for browser/message', () => {
    expect(formatToolOneLiner('browser', { action: 'click' })).toBe('browser click');
    expect(formatToolOneLiner('message', { action: 'send' })).toBe('message send');
  });

  it('falls back to common keys for unknown tools', () => {
    expect(formatToolOneLiner('custom_tool', { path: '/some/path' })).toBe('custom tool /some/path');
    expect(formatToolOneLiner('custom_tool', { query: 'search term' })).toBe('custom tool search term');
    expect(formatToolOneLiner('custom_tool', { name: 'test' })).toBe('custom tool test');
  });

  it('returns name only if no recognized key in args', () => {
    expect(formatToolOneLiner('custom_tool', { foo: 'bar' })).toBe('custom tool');
  });

  it('shortens /Users/xxx/ paths to ~/', () => {
    expect(formatToolOneLiner('read', { path: '/Users/john/project/file.ts' })).toBe('read ~/project/file.ts');
  });

  it('shortens /home/xxx/ paths to ~/', () => {
    expect(formatToolOneLiner('read', { path: '/home/john/project/file.ts' })).toBe('read ~/project/file.ts');
  });

  it('truncates long details to 60 chars', () => {
    const longCmd = 'a'.repeat(100);
    const result = formatToolOneLiner('exec', { command: longCmd });
    expect(result).toBe(`exec ${'a'.repeat(57)}...`);
    expect(result.length).toBe(4 + 1 + 60); // "exec" + space + 60 chars
  });
});

describe('formatToolDisplayName', () => {
  const t = (key: string) => `[${key}]`;

  it('maps known tools to localized labels', () => {
    expect(formatToolDisplayName('exec', t)).toBe('[Command]');
    expect(formatToolDisplayName('read', t)).toBe('[Read file]');
    expect(formatToolDisplayName('write', t)).toBe('[Write file]');
    expect(formatToolDisplayName('web_search', t)).toBe('[Web Search]');
    expect(formatToolDisplayName('web_fetch', t)).toBe('[Web Fetch]');
  });

  it('labels other backends\' names for the same commands, edits and web tools', () => {
    expect(formatToolDisplayName('terminal', t)).toBe('[Command]');
    expect(formatToolDisplayName('Bash', t)).toBe('[Command]');
    expect(formatToolDisplayName('patch', t)).toBe('[Write file]');
    expect(formatToolDisplayName('MultiEdit', t)).toBe('[Write file]');
    expect(formatToolDisplayName('WebFetch', t)).toBe('[Web Fetch]');
    expect(formatToolDisplayName('WebSearch', t)).toBe('[Web Search]');
  });

  it('keeps unknown tool names readable', () => {
    expect(formatToolDisplayName('custom_tool', t)).toBe('custom tool');
    expect(formatToolDisplayName('js', t)).toBe('js');
  });
});

describe('unwrapShellCommand', () => {
  it('names the command a Codex shell invocation ran', () => {
    expect(unwrapShellCommand('/bin/zsh -lc "git ls-files -z | python3 -c \\"print(1)\\""'))
      .toBe('git ls-files -z | python3 -c "print(1)"');
    expect(unwrapShellCommand("bash -lc 'echo it'\\''s done'")).toBe("echo it's done");
    expect(unwrapShellCommand('/usr/bin/sh -c "ls -la"')).toBe('ls -la');
    expect(resolveToolDetail('exec', { command: '/bin/zsh -lc "git status"' })).toBe('git status');
    expect(resolveToolDetail('terminal', { command: '/bin/zsh -lc "npm test"' })).toBe('npm test');
  });

  it('leaves plain commands and anything after the quoted script as recorded', () => {
    expect(unwrapShellCommand('git status')).toBe('git status');
    expect(unwrapShellCommand('/bin/zsh -lc "make" && echo done')).toBe('/bin/zsh -lc "make" && echo done');
    expect(resolveToolDetail('read', { path: '/bin/zsh -lc "x"' })).toBe('/bin/zsh -lc "x"');
  });
});

describe('resolveToolDetail for search tools', () => {
  it('names what Grep, Glob and their kin look for before where', () => {
    expect(resolveToolDetail('Grep', { pattern: 'useTranslation', path: '/Users/lucy/app/src' })).toBe('useTranslation');
    expect(resolveToolDetail('Glob', { pattern: '**/*.test.ts' })).toBe('**/*.test.ts');
    expect(resolveToolDetail('search_files', { pattern: 'TODO', path: 'src' })).toBe('TODO');
    expect(resolveToolDetail('ls', { path: '/Users/lucy/app' })).toBe('~/app');
    expect(resolveToolDetail('memory_search', { query: 'release' })).toBe('release');
  });
});

describe('formatToolOneLinerLocalized', () => {
  const t = (key: string) => `L:${key}`;

  it('localizes known tool labels while keeping detail raw', () => {
    expect(formatToolOneLinerLocalized('web_search', { query: 'expo docs' }, t)).toBe('L:Web Search expo docs');
    expect(formatToolOneLinerLocalized('exec', { command: 'npm run build' }, t)).toBe('L:Command npm run build');
  });
});

describe('stripToolStatusPrefix', () => {
  it('removes legacy English status prefixes from summary', () => {
    expect(stripToolStatusPrefix('Completed web search foo')).toBe('web search foo');
    expect(stripToolStatusPrefix('Failed web fetch bar')).toBe('web fetch bar');
    expect(stripToolStatusPrefix('Running command ls')).toBe('command ls');
  });

  it('returns summary unchanged when no prefix matches and no t provided', () => {
    expect(stripToolStatusPrefix('command ls')).toBe('command ls');
    expect(stripToolStatusPrefix('正在运行 command ls')).toBe('正在运行 command ls');
  });

  it('strips localized prefix-style status (e.g. zh-Hans)', () => {
    const zhT = (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'Running {{name}}': '正在运行 {{name}}',
        'Failed {{name}}': '{{name}} 失败',
        'Completed {{name}}': '已完成 {{name}}',
      };
      const tpl = map[key] ?? key;
      return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(opts?.[k] ?? ''));
    };
    expect(stripToolStatusPrefix('已完成 Command ~/foo', zhT)).toBe('Command ~/foo');
    expect(stripToolStatusPrefix('正在运行 Command ls', zhT)).toBe('Command ls');
  });

  it('strips localized suffix-style status (e.g. de)', () => {
    const deT = (key: string, opts?: Record<string, unknown>) => {
      const map: Record<string, string> = {
        'Running {{name}}': '{{name}} wird ausgeführt',
        'Failed {{name}}': '{{name}} fehlgeschlagen',
        'Completed {{name}}': '{{name}} abgeschlossen',
      };
      const tpl = map[key] ?? key;
      return tpl.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => String(opts?.[k] ?? ''));
    };
    expect(stripToolStatusPrefix('Command ~/foo abgeschlossen', deT)).toBe('Command ~/foo');
    expect(stripToolStatusPrefix('Command ls fehlgeschlagen', deT)).toBe('Command ls');
    expect(stripToolStatusPrefix('Command ls wird ausgeführt', deT)).toBe('Command ls');
  });
});
