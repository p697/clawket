import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';

/**
 * Where a device pairing keeps conversations that belong to no project.
 * A saved device pairing keeps the folder it was created with. New pairings
 * stay out of Documents: macOS asks at the computer before a new executable
 * may read that folder, and nobody can answer the prompt from the phone.
 */
export function deviceChatsRoot(deviceConfigPath: string): string {
  try {
    const saved = JSON.parse(readFileSync(deviceConfigPath, 'utf8'));
    if (saved?.device === true && typeof saved.project === 'string' && isAbsolute(saved.project)) return saved.project;
  } catch { /* No saved pairing at this scope. */ }
  return join(homedir(), 'Clawket', 'Chats');
}
