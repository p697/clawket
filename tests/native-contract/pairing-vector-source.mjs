/** Fail closed on source drift instead of silently generating self-confirming native fixtures. */
export function extractPairingVectorSource(pairingSource, authSource) {
  if (typeof pairingSource !== 'string' || !pairingSource.trim() || typeof authSource !== 'string' || !authSource.trim()) {
    throw Error('Current mobile pairing/auth source is missing or empty');
  }
  for (const marker of ['nacl.box.open(', 'nacl.secretbox.open(']) {
    if (!pairingSource.includes(marker)) throw Error(`Current pairing implementation lost ${marker}`);
  }
  function template(prefix) {
    const matches = [...pairingSource.matchAll(new RegExp('`' + prefix + '[^`]+`', 'g'))];
    if (matches.length !== 1) throw Error(`Current proof template is missing or ambiguous: ${prefix}`);
    return matches[0][0];
  }
  const start = authSource.indexOf('export function buildDeviceAuthPayload');
  const end = authSource.indexOf('export function normalizeWsUrl', start);
  if (start < 0 || end <= start) throw Error('Current device auth function is missing');
  const authReturn = authSource.slice(start, end).match(/return \[[\s\S]+?\]\.join\('\|'\);/)?.[0];
  if (!authReturn) throw Error('Current device auth payload expression is missing');
  return { startTemplate: template('clawket-pair-v2:start:'), resultTemplate: template('clawket-pair-v2:result:'), authReturn };
}
