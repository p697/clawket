export type RequirementStatus = {
  bins?: string[];
  anyBins?: string[];
  env?: string[];
  config?: string[];
  os?: string[];
};

export type SkillConfigCheck = {
  path: string;
  label: string;
  satisfied: boolean;
};

export type SkillInstallOption = {
  id: string;
  kind: 'brew' | 'node' | 'go' | 'uv' | 'download';
  label: string;
  bins: string[];
};

export type SkillLinkedFiles = {
  references?: string[];
  templates?: string[];
  assets?: string[];
  scripts?: string[];
  other?: string[];
} | null;

export type SkillStatusEntry = {
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
  requirements: RequirementStatus;
  missing: RequirementStatus;
  configChecks: SkillConfigCheck[];
  install: SkillInstallOption[];
};

export type SkillStatusReport = {
  workspaceDir: string;
  managedSkillsDir: string;
  skills: SkillStatusEntry[];
};

export type SkillContentDetail = {
  skillKey: string;
  name: string;
  path: string;
  content: string;
  filePath?: string | null;
  fileType?: string | null;
  isBinary?: boolean;
  linkedFiles: SkillLinkedFiles;
  editable: boolean;
};
