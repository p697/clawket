import { HERMES_SKILLS_COMPAT_PYTHON } from './skills-compat.js';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  HERMES_AGENT_FILE_NAMES,
  isRecord,
  normalizeStringArray,
  readBoolean,
  readNumber,
  readString,
  requireNonEmptyString,
} from './internal.js';

type HermesSkillRequirementStatus = {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
};

type HermesSkillConfigCheck = {
  path: string;
  label: string;
  satisfied: boolean;
};

type HermesSkillInstallOption = {
  id: string;
  kind: 'brew' | 'node' | 'go' | 'uv' | 'download';
  label: string;
  bins: string[];
};

type HermesSkillStatusEntry = {
  name: string;
  description: string;
  source: string;
  bundled: boolean;
  filePath: string;
  baseDir: string;
  skillKey: string;
  primaryEnv?: string;
  emoji?: string;
  homepage?: string;
  always: boolean;
  disabled: boolean;
  blockedByAllowlist: boolean;
  eligible: boolean;
  createdAtMs?: number;
  updatedAtMs?: number;
  deletable?: boolean;
  requirements: HermesSkillRequirementStatus;
  missing: HermesSkillRequirementStatus;
  configChecks: HermesSkillConfigCheck[];
  install: HermesSkillInstallOption[];
};

type HermesSkillStatusReport = {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: HermesSkillStatusEntry[];
};

type HermesSkillLinkedFiles = {
  references?: string[];
  templates?: string[];
  assets?: string[];
  scripts?: string[];
  other?: string[];
} | null;

type HermesSkillContentDetail = {
  skillKey: string;
  name: string;
  path: string;
  content: string;
  filePath?: string | null;
  fileType?: string | null;
  isBinary?: boolean;
  linkedFiles: HermesSkillLinkedFiles;
  editable: boolean;
};


export abstract class HermesManagementMethods {
  declare hermesHomePath: string;
  declare hermesSourcePath: string;
  declare runHermesPython: <T>(script: string, stdinPayload?: unknown) => Promise<T>;

  listHermesAgentFiles(agentId: string): Array<{
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  }> {
    this.assertSupportedHermesAgentId(agentId);
    return HERMES_AGENT_FILE_NAMES.map((name) => this.readHermesAgentFileSummary(name));
  }

  getHermesAgentFile(
    agentId: string,
    name: string | null,
  ): {
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
    content?: string;
  } {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedName = this.normalizeHermesAgentFileName(name);
    const summary = this.readHermesAgentFileSummary(normalizedName);
    return {
      ...summary,
      content: summary.missing ? '' : readFileSync(summary.path, 'utf8'),
    };
  }

  setHermesAgentFile(agentId: string, name: string | null, content: string): void {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedName = this.normalizeHermesAgentFileName(name);
    const path = this.getHermesAgentFilePath(normalizedName);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content, 'utf8');
  }

  readHermesAgentFileSummary(name: (typeof HERMES_AGENT_FILE_NAMES)[number]): {
    name: string;
    path: string;
    missing: boolean;
    size?: number;
    updatedAtMs?: number;
  } {
    const path = this.getHermesAgentFilePath(name);
    if (!existsSync(path)) {
      return {
        name,
        path,
        missing: true,
      };
    }

    const stats = statSync(path);
    return {
      name,
      path,
      missing: false,
      size: stats.size,
      updatedAtMs: stats.mtimeMs,
    };
  }

  getHermesAgentFilePath(name: (typeof HERMES_AGENT_FILE_NAMES)[number]): string {
    return join(this.hermesHomePath, 'memories', name);
  }

  normalizeHermesAgentFileName(name: string | null): (typeof HERMES_AGENT_FILE_NAMES)[number] {
    if (name === 'MEMORY.md' || name === 'USER.md') {
      return name;
    }
    throw new Error(`Unsupported Hermes agent file: ${name || 'unknown'}.`);
  }

  assertSupportedHermesAgentId(agentId: string): void {
    if (agentId !== 'main') {
      throw new Error(`Hermes bridge exposes memory files for the main agent only (received: ${agentId}).`);
    }
  }

  async getHermesSkillsStatus(agentId: string): Promise<HermesSkillStatusReport> {
    this.assertSupportedHermesAgentId(agentId);
    return (await this.runHermesPython<HermesSkillStatusReport>(
      [
        'import json, os',
        'from pathlib import Path',
        'from agent.skill_utils import get_external_skills_dirs',
        ...HERMES_SKILLS_COMPAT_PYTHON,
        'def resolve_created_at(path: Path):',
        '  try:',
        '    stat = path.stat()',
        '  except Exception:',
        '    return None',
        '  for attr in ("st_birthtime", "st_ctime", "st_mtime"):',
        '    value = getattr(stat, attr, None)',
        '    if value is not None:',
        '      return int(float(value) * 1000)',
        '  return None',
        'def resolve_updated_at(path: Path):',
        '  latest = None',
        '  for child in path.rglob("*"):',
        '    if not child.is_file():',
        '      continue',
        '    try:',
        '      value = int(float(child.stat().st_mtime) * 1000)',
        '    except Exception:',
        '      continue',
        '    latest = value if latest is None else max(latest, value)',
        '  return latest',
        'def load_json(path: Path, default):',
        '  try:',
        '    if path.exists():',
        '      return json.loads(path.read_text(encoding="utf-8"))',
        '  except Exception:',
        '    pass',
        '  return default',
        'def load_config():',
        '  cfg_path = Path(os.environ.get("HERMES_HOME", "")) / "config.yaml"',
        '  if not cfg_path.exists():',
        '    return {}',
        '  try:',
        '    import yaml',
        '    parsed = yaml.safe_load(cfg_path.read_text(encoding="utf-8"))',
        '    return parsed if isinstance(parsed, dict) else {}',
        '  except Exception:',
        '    return {}',
        'cfg = load_config()',
        'skills_cfg = cfg.get("skills") if isinstance(cfg.get("skills"), dict) else {}',
        'disabled = {str(v).strip() for v in (skills_cfg.get("disabled") or []) if str(v).strip()}',
        'env_snapshot = load_env()',
        'dirs_to_scan = []',
        'if SKILLS_DIR.exists():',
        '  dirs_to_scan.append(SKILLS_DIR)',
        'dirs_to_scan.extend([d for d in get_external_skills_dirs() if d.exists()])',
        'seen = set()',
        'skills = []',
        'for scan_dir in dirs_to_scan:',
        '  for skill_md in scan_dir.rglob("SKILL.md"):',
        '    if any(part in {".git", ".github", ".hub"} for part in skill_md.parts):',
        '      continue',
        '    try:',
        '      content = skill_md.read_text(encoding="utf-8")',
        '      frontmatter, body = _parse_frontmatter(content)',
        '    except Exception:',
        '      continue',
        '    if not skill_matches_platform(frontmatter):',
        '      continue',
        '    skill_dir = skill_md.parent',
        '    name = str(frontmatter.get("name") or skill_dir.name).strip()',
        '    if not name or name in seen:',
        '      continue',
        '    seen.add(name)',
        '    description = str(frontmatter.get("description") or "").strip()',
        '    if not description:',
        '      for line in body.splitlines():',
        '        line = line.strip()',
        '        if line and not line.startswith("#"):',
        '          description = line',
        '          break',
        '    legacy_env, legacy_cmds = _collect_prerequisite_values(frontmatter)',
        '    required_env = _get_required_environment_variables(frontmatter, legacy_env)',
        '    required_env_names = [str(entry.get("name") or "").strip() for entry in required_env if str(entry.get("name") or "").strip()]',
        '    missing_env = [name for name in required_env_names if not str(env_snapshot.get(name) or "").strip()]',
        '    required_cmds = [str(cmd).strip() for cmd in legacy_cmds if str(cmd).strip()]',
        '    missing_cmds = []',
        '    if required_cmds:',
        '      import shutil',
        '      missing_cmds = [cmd for cmd in required_cmds if shutil.which(cmd) is None]',
        '    required_cred_files = frontmatter.get("required_credential_files") or []',
        '    if not isinstance(required_cred_files, list):',
        '      required_cred_files = []',
        '    missing_cred = []',
        '    for raw in required_cred_files:',
        '      rel = str(raw).strip()',
        '      if not rel:',
        '        continue',
        '      candidate = Path(os.path.expandvars(os.path.expanduser(rel)))',
        '      if not candidate.exists():',
        '        missing_cred.append(rel)',
        '    try:',
        '      rel_path = str(skill_md.relative_to(SKILLS_DIR))',
        '      source = "managed"',
        '    except Exception:',
        '      rel_path = str(skill_md)',
        '      source = "workspace"',
        '    created_at = resolve_created_at(skill_dir) or resolve_created_at(skill_md)',
        '    updated_at = resolve_updated_at(skill_dir) or resolve_created_at(skill_md)',
        '    requirements = {',
        '      "bins": required_cmds,',
        '      "env": required_env_names,',
        '      "config": [str(item).strip() for item in required_cred_files if str(item).strip()],',
        '      "os": [],',
        '    }',
        '    missing = {',
        '      "bins": missing_cmds,',
        '      "env": missing_env,',
        '      "config": missing_cred,',
        '      "os": [],',
        '    }',
        '    config_checks = [',
        '      {"path": env_name, "label": env_name, "satisfied": env_name not in missing_env}',
        '      for env_name in required_env_names',
        '    ]',
        '    metadata = frontmatter.get("metadata") if isinstance(frontmatter.get("metadata"), dict) else {}',
        '    hermes_meta = metadata.get("hermes") if isinstance(metadata.get("hermes"), dict) else {}',
        '    primary_env = required_env_names[0] if required_env_names else ""',
        '    skills.append({',
        '      "name": name,',
        '      "description": description,',
        '      "source": source,',
        '      "bundled": False,',
        '      "filePath": str(skill_md),',
        '      "baseDir": str(skill_dir),',
        '      "skillKey": name,',
        '      "primaryEnv": primary_env or None,',
        '      "emoji": hermes_meta.get("emoji") if isinstance(hermes_meta.get("emoji"), str) else None,',
        '      "homepage": frontmatter.get("homepage") if isinstance(frontmatter.get("homepage"), str) else None,',
        '      "always": False,',
        '      "disabled": name in disabled,',
        '      "blockedByAllowlist": False,',
        '      "eligible": (name not in disabled) and not missing_env and not missing_cmds and not missing_cred,',
        '      "createdAtMs": created_at,',
        '      "updatedAtMs": updated_at,',
        '      "deletable": source == "managed",',
        '      "requirements": requirements,',
        '      "missing": missing,',
        '      "configChecks": config_checks,',
        '      "install": [],',
        '    })',
        'skills.sort(key=lambda item: item.get("name", "").lower())',
        'print(json.dumps({',
        '  "workspaceDir": str(Path(os.environ.get("HERMES_HOME", ""))),',
        '  "managedSkillsDir": str(SKILLS_DIR),',
        '  "skills": skills,',
        '}))',
      ].join('\n'),
    ));
  }

  async getHermesSkillDetail(
    agentId: string,
    skillKey: string | null,
    filePath: string | null,
  ): Promise<HermesSkillContentDetail> {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedSkillKey = skillKey?.trim();
    if (!normalizedSkillKey) {
      throw new Error('skills.get requires skillKey.');
    }
    const result = (await this.runHermesPython<HermesSkillContentDetail & {
      success?: boolean;
      error?: string;
    }>(
      [
        'import json',
        'from pathlib import Path',
        'from agent.skill_utils import get_external_skills_dirs',
        ...HERMES_SKILLS_COMPAT_PYTHON,
        'payload = json.loads(input() or "{}")',
        'skill_key = str(payload.get("skillKey") or "").strip()',
        'file_path = payload.get("filePath")',
        'if not skill_key:',
        '  print(json.dumps({"success": False, "error": "skills.get requires skillKey."}))',
        '  raise SystemExit(0)',
        'dirs_to_scan = []',
        'if SKILLS_DIR.exists():',
        '  dirs_to_scan.append(SKILLS_DIR)',
        'dirs_to_scan.extend([d for d in get_external_skills_dirs() if d.exists()])',
        'skill_md = None',
        'skill_dir = None',
        'for search_dir in dirs_to_scan:',
        '  direct = search_dir / skill_key',
        '  if direct.is_dir() and (direct / "SKILL.md").exists():',
        '    skill_dir = direct',
        '    skill_md = direct / "SKILL.md"',
        '    break',
        'for search_dir in dirs_to_scan if skill_md is None else []:',
        '  for found in search_dir.rglob("SKILL.md"):',
        '    if found.parent.name == skill_key:',
        '      skill_dir = found.parent',
        '      skill_md = found',
        '      break',
        '  if skill_md is not None:',
        '    break',
        'if skill_md is None or skill_dir is None or not skill_md.exists():',
        '  print(json.dumps({"success": False, "error": f"Skill \'{skill_key}\' not found."}))',
        '  raise SystemExit(0)',
        'raw_content = skill_md.read_text(encoding="utf-8")',
        'frontmatter, _ = _parse_frontmatter(raw_content)',
        'name = str(frontmatter.get("name") or skill_dir.name).strip() or skill_key',
        'linked = {"references": [], "templates": [], "assets": [], "scripts": [], "other": []}',
        'for root_name in ("references", "templates", "assets", "scripts"):',
        '  root_dir = skill_dir / root_name',
        '  if root_dir.exists():',
        '    for child in sorted(root_dir.rglob("*")):',
        '      if child.is_file():',
        '        linked[root_name].append(str(child.relative_to(skill_dir)))',
        'for child in sorted(skill_dir.rglob("*")):',
        '  if not child.is_file() or child.name == "SKILL.md":',
        '    continue',
        '  rel = str(child.relative_to(skill_dir))',
        '  if any(rel.startswith(prefix + "/") for prefix in ("references", "templates", "assets", "scripts")):',
        '    continue',
        '  linked["other"].append(rel)',
        'linked = {key: value for key, value in linked.items() if value}',
        'target_path = None',
        'editable = False',
        'content = raw_content',
        'file_type = ".md"',
        'is_binary = False',
        'if file_path:',
        '  normalized = Path(str(file_path))',
        '  if ".." in normalized.parts:',
        '    print(json.dumps({"success": False, "error": "Path traversal is not allowed."}))',
        '    raise SystemExit(0)',
        '  candidate = (skill_dir / normalized)',
        '  resolved = candidate.resolve()',
        '  if skill_dir.resolve() not in resolved.parents and resolved != skill_dir.resolve():',
        '    print(json.dumps({"success": False, "error": "Path escapes skill directory boundary."}))',
        '    raise SystemExit(0)',
        '  if not candidate.exists() or not candidate.is_file():',
        '    print(json.dumps({"success": False, "error": f"File \'{file_path}\' not found in skill \'{skill_key}\'."}))',
        '    raise SystemExit(0)',
        '  target_path = str(normalized)',
        '  editable = False',
        '  file_type = candidate.suffix or None',
        '  try:',
        '    content = candidate.read_text(encoding="utf-8")',
        '  except UnicodeDecodeError:',
        '    is_binary = True',
        '    content = f"[Binary file: {candidate.name}, size: {candidate.stat().st_size} bytes]"',
        'else:',
        '  editable = True',
        'try:',
        '  rel_path = str(skill_md.relative_to(SKILLS_DIR))',
        'except Exception:',
        '  rel_path = str(skill_md)',
        'print(json.dumps({',
        '  "success": True,',
        '  "skillKey": name,',
        '  "name": name,',
        '  "path": rel_path,',
        '  "content": content,',
        '  "filePath": target_path,',
        '  "fileType": file_type,',
        '  "isBinary": is_binary,',
        '  "linkedFiles": linked or None,',
        '  "editable": editable,',
        '}))',
      ].join('\n'),
      {
        skillKey: normalizedSkillKey,
        ...(filePath?.trim() ? { filePath: filePath.trim() } : {}),
      },
    ));
    if (result.success === false) {
      throw new Error(readString(result.error) || 'Failed to load Hermes skill.');
    }
    return {
      skillKey: readString(result.skillKey) || normalizedSkillKey,
      name: readString(result.name) || normalizedSkillKey,
      path: readString(result.path) || '',
      content: readString(result.content) || '',
      filePath: readString(result.filePath),
      fileType: readString(result.fileType),
      isBinary: readBoolean(result.isBinary) ?? false,
      linkedFiles: isRecord(result.linkedFiles) ? result.linkedFiles as HermesSkillLinkedFiles : null,
      editable: readBoolean(result.editable) ?? false,
    };
  }

  async updateHermesSkill(agentId: string, payload: Record<string, unknown>): Promise<{
    ok: boolean;
    skillKey: string;
    config: Record<string, unknown>;
  }> {
    this.assertSupportedHermesAgentId(agentId);
    const skillKey = readString(payload.skillKey)?.trim();
    if (!skillKey) {
      throw new Error('skills.update requires skillKey.');
    }
    const result = (await this.runHermesPython<{
      ok?: boolean;
      skillKey?: string;
      config?: Record<string, unknown>;
      error?: string;
    }>(
      [
        'import json',
        'from pathlib import Path',
        'from hermes_cli.config import load_config, save_config',
        'from tools.skills_tool import _find_all_skills',
        ...HERMES_SKILLS_COMPAT_PYTHON,
        'from tools.skill_manager_tool import _find_skill',
        'payload = json.loads(input() or "{}")',
        'skill_key = str(payload.get("skillKey") or "").strip()',
        'if not skill_key:',
        '  print(json.dumps({"ok": False, "error": "skills.update requires skillKey."}))',
        '  raise SystemExit(0)',
        'cfg = load_config() or {}',
        'skills_cfg = cfg.setdefault("skills", {})',
        'disabled = {str(v).strip() for v in (skills_cfg.get("disabled") or []) if str(v).strip()}',
        'enabled = payload.get("enabled")',
        'if isinstance(enabled, bool):',
        '  if enabled:',
        '    disabled.discard(skill_key)',
        '  else:',
        '    disabled.add(skill_key)',
        '  skills_cfg["disabled"] = sorted(disabled)',
        '  save_config(cfg)',
        'skill_dir = None',
        'found = _find_skill(skill_key)',
        'if found:',
        '  skill_dir = found.get("path")',
        'env_updates = payload.get("env") if isinstance(payload.get("env"), dict) else {}',
        'api_key = payload.get("apiKey")',
        'if api_key is not None and skill_dir is not None:',
        '  skill_md = Path(skill_dir) / "SKILL.md"',
        '  primary_env = None',
        '  try:',
        '    content = skill_md.read_text(encoding="utf-8")',
        '    frontmatter, _ = _parse_frontmatter(content)',
        '    legacy_env, _ = _collect_prerequisite_values(frontmatter)',
        '    required_env = _get_required_environment_variables(frontmatter, legacy_env)',
        '    primary_env = next((str(entry.get("name") or "").strip() for entry in required_env if str(entry.get("name") or "").strip()), None)',
        '  except Exception:',
        '    primary_env = None',
        '  if primary_env:',
        '    env_updates = dict(env_updates)',
        '    env_updates[primary_env] = str(api_key or "")',
        'if env_updates:',
        '  env_path = Path.home()',
        '  from hermes_constants import get_hermes_home',
        '  env_path = get_hermes_home() / ".env"',
        '  existing = load_env()',
        '  for key, value in env_updates.items():',
        '    k = str(key).strip()',
        '    if not k:',
        '      continue',
        '    v = str(value).strip()',
        '    if v:',
        '      existing[k] = v',
        '    elif k in existing:',
        '      del existing[k]',
        '  env_path.parent.mkdir(parents=True, exist_ok=True)',
        '  lines = [f"{key}={value}" for key, value in sorted(existing.items())]',
        '  env_path.write_text("\\n".join(lines) + ("\\n" if lines else ""), encoding="utf-8")',
        'print(json.dumps({"ok": True, "skillKey": skill_key, "config": {"enabled": skill_key not in disabled}}))',
      ].join('\n'),
      {
        skillKey,
        ...(payload.enabled !== undefined ? { enabled: payload.enabled } : {}),
        ...(payload.apiKey !== undefined ? { apiKey: payload.apiKey } : {}),
        ...(isRecord(payload.env) ? { env: payload.env } : {}),
      },
    ));
    if (result.ok === false) {
      throw new Error(readString(result.error) || 'Failed to update Hermes skill.');
    }
    return {
      ok: result.ok ?? true,
      skillKey: readString(result.skillKey) || skillKey,
      config: isRecord(result.config) ? result.config : {},
    };
  }

  async deleteHermesSkill(
    agentId: string,
    skillKey: string | null,
  ): Promise<{
    ok: boolean;
    skillKey: string;
  }> {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedSkillKey = skillKey?.trim();
    if (!normalizedSkillKey) {
      throw new Error('skills.delete requires skillKey.');
    }
    const result = (await this.runHermesPython<{
      success?: boolean;
      ok?: boolean;
      error?: string;
    }>(
      [
        'import json',
        'from pathlib import Path',
        'from hermes_cli.config import load_config, save_config',
        'from tools.skill_manager_tool import _find_skill, skill_manage',
        'from tools.skills_tool import SKILLS_DIR',
        'payload = json.loads(input() or "{}")',
        'skill_key = str(payload.get("skillKey") or "").strip()',
        'if not skill_key:',
        '  print(json.dumps({"success": False, "error": "skills.delete requires skillKey."}))',
        '  raise SystemExit(0)',
        'found = _find_skill(skill_key)',
        'if not found or not found.get("path"):',
        '  print(json.dumps({"success": False, "error": f"Skill \'{skill_key}\' not found."}))',
        '  raise SystemExit(0)',
        'skill_path = Path(found.get("path")).resolve()',
        'managed_root = SKILLS_DIR.resolve()',
        'if managed_root not in skill_path.parents:',
        '  print(json.dumps({"success": False, "error": "Only managed Hermes skills can be deleted from Clawket."}))',
        '  raise SystemExit(0)',
        'result = json.loads(skill_manage(action="delete", name=skill_key))',
        'if result.get("success"):',
        '  cfg = load_config() or {}',
        '  skills_cfg = cfg.setdefault("skills", {})',
        '  disabled = [str(v).strip() for v in (skills_cfg.get("disabled") or []) if str(v).strip()]',
        '  if skill_key in disabled:',
        '    skills_cfg["disabled"] = [item for item in disabled if item != skill_key]',
        '    save_config(cfg)',
        'print(json.dumps(result))',
      ].join('\n'),
      { skillKey: normalizedSkillKey },
    ));
    if (result.success === false || result.ok === false) {
      throw new Error(readString(result.error) || 'Failed to delete Hermes skill.');
    }
    return {
      ok: true,
      skillKey: normalizedSkillKey,
    };
  }

  async updateHermesSkillContent(
    agentId: string,
    skillKey: string | null,
    content: string,
  ): Promise<{
    ok: boolean;
    skillKey: string;
    path: string;
  }> {
    this.assertSupportedHermesAgentId(agentId);
    const normalizedSkillKey = skillKey?.trim();
    if (!normalizedSkillKey) {
      throw new Error('skills.content.update requires skillKey.');
    }
    const result = (await this.runHermesPython<{
      success?: boolean;
      error?: string;
      path?: string;
    }>(
      [
        'import json',
        'from tools.skill_manager_tool import _find_skill, skill_manage',
        'payload = json.loads(input() or "{}")',
        'skill_key = str(payload.get("skillKey") or "").strip()',
        'content = str(payload.get("content") or "")',
        'if not skill_key:',
        '  print(json.dumps({"success": False, "error": "skills.content.update requires skillKey."}))',
        '  raise SystemExit(0)',
        'result = json.loads(skill_manage(action="edit", name=skill_key, content=content))',
        'if result.get("success"):',
        '  found = _find_skill(skill_key) or {}',
        '  result["path"] = str(found.get("path") or "")',
        'print(json.dumps(result))',
      ].join('\n'),
      {
        skillKey: normalizedSkillKey,
        content,
      },
    ));
    if (result.success === false) {
      throw new Error(readString(result.error) || 'Failed to update Hermes skill content.');
    }
    return {
      ok: true,
      skillKey: normalizedSkillKey,
      path: readString(result.path) || '',
    };
  }
}
