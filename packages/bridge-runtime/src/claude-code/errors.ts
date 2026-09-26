/** Only deliberately user-facing errors may cross the authenticated Bridge boundary. */
export class ClaudeFault extends Error {
  constructor(message: string) { super(message); this.name = 'ClaudeFault'; }
}
