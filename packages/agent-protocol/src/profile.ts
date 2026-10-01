/** Additive management surface, available only after profile protocol negotiation. */
export interface ProfileProject { id: string; name: string; available: boolean }
export interface ProfileModel { id: string; name: string; isDefault: boolean; levels: string[]; defaultLevel?: string }
export interface ProfileDefaults { model: string | null; thinking: string | null; version: string; editable: boolean; models: ProfileModel[] }
export interface ProfileQuota { id: string; name: string; windows: Array<{ minutes: number; usedPercent: number; resetsAt: number | null }> }
export interface ProfileUsage { plan: string | null; quotas: ProfileQuota[]; lifetimeTokens: number | null; daily: Array<{ date: string; tokens: number }> }
export interface ProfileSkill {
  id: string; name: string; description: string; scope: 'project' | 'user' | 'system' | 'plugin'; enabled: boolean; editable: boolean;
}
export interface ProfileSkills { skills: ProfileSkill[]; errorCount: number }
export interface ProfileDocument { id: string; name: string; content: string; version: string; editable: boolean; missing: boolean; size: number }
export interface ProfileInstruction { id: string; name: string; exists: boolean; scope: 'project' | 'user' }
export interface ProfileMcp { name: string; auth: 'authenticated' | 'required' | 'unsupported' | 'unknown'; toolsAvailable: boolean; tools: Array<{ name: string; description: string }> }
export interface ProfilePlugin { id: string; name: string; description: string; enabled: boolean }
export interface AgentProfileOperations {
  projects(): Promise<ProfileProject[]>;
  defaults(): Promise<ProfileDefaults>;
  setDefaults(input: { model: string | null; thinking: string | null; version: string }): Promise<ProfileDefaults>;
  usage(): Promise<ProfileUsage>;
  skills(projectId: string, forceReload?: boolean): Promise<ProfileSkills>;
  setSkillEnabled(id: string, enabled: boolean): Promise<ProfileSkills>;
  instructions(projectId: string): Promise<ProfileInstruction[]>;
  document(id: string): Promise<ProfileDocument>;
  saveDocument(input: { id: string; content: string; version: string }): Promise<ProfileDocument>;
  mcp(): Promise<ProfileMcp[]>;
  plugins(projectId: string): Promise<ProfilePlugin[]>;
}
