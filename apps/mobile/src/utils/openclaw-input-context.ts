/** Decode known model-input envelopes only. Callers must verify native CLI provenance. */
export function stripOpenClawInputContext(text: string): string {
  const skill = /^Use the following explicitly referenced skills for this request\. Read each skill's SKILL\.md before acting:\n((?:- [^\n]+\n){1,32})\nUser request:\n\n?([\s\S]*)$/.exec(text);
  if (skill && skill[1].length < 16_384) {
    const names = skill[1].trimEnd().split('\n').map(line => /^- ([a-zA-Z0-9][a-zA-Z0-9._/-]{0,127})(?: \([^\n]+\))?$/.exec(line)?.[1]);
    if (names.every(name => name && skill[2].includes(`$${name}`))) text = skill[2];
  }
  const first = /^\[media attached: (media:\/\/inbound\/[^\s\]\r\n]+) \(([a-zA-Z0-9.+-]+\/[a-zA-Z0-9.+-]+)\)\]\r?\n/.exec(text);
  if (!first) return text;
  const body = text.slice(first[0].length);
  const marker = `\n[media attached: ${first[1]}]`;
  const end = body.lastIndexOf(marker);
  if (end < 0) return text;
  const suffix = body.slice(end + marker.length).trim();
  const file = /^<file name="([^"\r\n]+)" mime="([^"\r\n]+)">\s*<<<EXTERNAL_UNTRUSTED_CONTENT id="([a-f0-9]+)">>>[\s\S]*<<<END_EXTERNAL_UNTRUSTED_CONTENT id="\3">>>\s*<\/file>$/.exec(suffix);
  if (!file || file[1] !== first[1].split('/').at(-1) || file[2] !== first[2]) return text;
  return body.slice(0, end);
}
