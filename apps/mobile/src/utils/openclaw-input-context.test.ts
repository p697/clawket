import { stripOpenClawInputContext } from './openclaw-input-context';
export const skillInput = "Use the following explicitly referenced skills for this request. Read each skill's SKILL.md before acting:\n- apple-notes\n\nUser request:\n$apple-notes\n\nWhat is this?";
export const fileInput = '[media attached: media://inbound/report.pdf (application/pdf)]\nRead this\n[media attached: media://inbound/report.pdf]\n\n<file name="report.pdf" mime="application/pdf">\n<<<EXTERNAL_UNTRUSTED_CONTENT id="abc123">>>\nprivate extracted text\n<<<END_EXTERNAL_UNTRUSTED_CONTENT id="abc123">>>\n</file>';
it('recovers the original skill request and document caption', () => {
  expect(stripOpenClawInputContext(skillInput)).toBe('$apple-notes\n\nWhat is this?');
  expect(stripOpenClawInputContext(fileInput)).toBe('Read this');
});
it('preserves quoted, malformed and unmatched wrappers', () => {
  for (const text of ['Explain: '+skillInput, '```\n'+fileInput+'\n```', fileInput.replace('id="abc123">>>\n</file>', 'id="other">>>\n</file>'), fileInput+'\nExtra user text', skillInput.replace('$apple-notes', '$other')]) expect(stripOpenClawInputContext(text)).toBe(text);
});
