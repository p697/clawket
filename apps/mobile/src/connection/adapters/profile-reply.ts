const object = (v: any): boolean => v !== null && typeof v === 'object' && !Array.isArray(v);
const text = (v: any, max = 256): boolean => typeof v === 'string' && v.length > 0 && v.length <= max;
const nullableText = (v: any): boolean => v === null || text(v);
const number = (v: any): boolean => Number.isSafeInteger(v) && v >= 0;
const list = (v: any, check: (row: any) => boolean, max = 500): boolean => Array.isArray(v) && v.length <= max && v.every(row => object(row) && check(row));
const bool = (v: any): boolean => typeof v === 'boolean';
const description = (v: any): boolean => typeof v === 'string' && v.length <= 2000;
const unique = (v: any[], field: string): boolean => new Set(v.map(row => row[field])).size === v.length;

/** Validate the complete versioned reply before a management view can render it. */
export function validProfileReply(method: string, value: any): boolean {
  switch (method) {
    case 'profile.projects': return list(value, row => text(row.id) && text(row.name) && bool(row.available), 10000) && unique(value, 'id');
    case 'profile.defaults': case 'profile.defaults.set':
      return object(value) && nullableText(value.model) && nullableText(value.thinking) && text(value.version, 512) && bool(value.editable)
        && list(value.models, row => text(row.id) && text(row.name) && bool(row.isDefault) && Array.isArray(row.levels) && row.levels.length <= 16 && row.levels.every((level: any) => text(level, 32)) && (row.defaultLevel === undefined || text(row.defaultLevel, 32)), 2000) && unique(value.models, 'id');
    case 'profile.usage': return object(value) && nullableText(value.plan) && (value.lifetimeTokens === null || number(value.lifetimeTokens))
      && list(value.quotas, row => text(row.id) && text(row.name) && list(row.windows, window => Number.isFinite(window.usedPercent) && window.usedPercent >= 0 && number(window.minutes) && window.minutes > 0 && (window.resetsAt === null || number(window.resetsAt) && window.resetsAt <= 8640000000000), 2), 32) && unique(value.quotas, 'id')
      && list(value.daily, row => typeof row.date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(row.date) && number(row.tokens), 400) && unique(value.daily, 'date');
    case 'profile.skills': case 'profile.skills.set': return object(value) && number(value.errorCount) && value.errorCount <= 500
      && list(value.skills, row => text(row.id) && text(row.name) && description(row.description) && ['project', 'user', 'system', 'plugin'].includes(row.scope) && bool(row.enabled) && bool(row.editable)) && unique(value.skills, 'id');
    case 'profile.instructions': return list(value, row => text(row.id) && ['AGENTS.md', 'AGENTS.override.md'].includes(row.name) && ['project', 'user'].includes(row.scope) && bool(row.exists), 4) && unique(value, 'id');
    case 'profile.document': case 'profile.document.set': return object(value) && text(value.id) && text(value.name) && text(value.version, 512) && typeof value.content === 'string' && value.content.length <= 128 * 1024 && !value.content.includes('\0') && bool(value.editable) && bool(value.missing) && number(value.size) && value.size <= 128 * 1024;
    case 'profile.mcp': return list(value, row => text(row.name) && bool(row.toolsAvailable) && ['authenticated', 'required', 'unsupported', 'unknown'].includes(row.auth) && list(row.tools, tool => text(tool.name) && description(tool.description), 2000) && unique(row.tools, 'name')) && unique(value, 'name');
    case 'profile.plugins': return list(value, row => text(row.id) && text(row.name) && description(row.description) && bool(row.enabled)) && unique(value, 'id');
    default: return false;
  }
}
