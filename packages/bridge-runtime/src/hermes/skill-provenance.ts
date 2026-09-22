/** Shared by native listing and removal; match provenance by contained install path, never display name. */
export const HERMES_SKILL_PROVENANCE_PYTHON = [
  'def clawket_hub_entries():',
  '  registry = SKILLS_DIR / ".hub" / "lock.json"',
  '  if not registry.exists(): return {}',
  '  if registry.is_symlink() or registry.stat().st_size > 1000000: raise ValueError("Invalid skill registry")',
  '  value = json.loads(registry.read_text(encoding="utf-8"))',
  '  if not isinstance(value, dict) or not isinstance(value.get("installed"), dict): raise ValueError("Invalid skill registry")',
  '  root = SKILLS_DIR.resolve()',
  '  entries = {}',
  '  for name, entry in value["installed"].items():',
  '    if not isinstance(entry, dict): raise ValueError("Invalid skill registry")',
  '    relative = entry.get("install_path")',
  '    if not isinstance(relative, str) or not relative or Path(relative).is_absolute(): raise ValueError("Invalid skill install path")',
  '    path = (root / relative).resolve()',
  '    if root not in path.parents or path in entries: raise ValueError("Invalid skill install path")',
  '    entries[path] = (name, entry)',
  '  return entries',
] as const;
