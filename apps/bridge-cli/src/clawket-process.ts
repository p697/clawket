/** Managed snapshots, npx caches and global installs run the same published bundle from
 * different paths, so a command started by one install is still a Clawket runtime to another. */
export function isClawketBridgeRuntimeCommand(command: string, scriptPath: string): boolean {
  if (scriptPath && command.includes(scriptPath)) return true;
  return /(?:^|\s)\S*(?:@p697\/clawket|apps\/bridge-cli)\/dist\/index\.js(?:\s|$)/.test(command);
}
