import { Buffer } from 'node:buffer';
import { isRecord, readString } from './internal.js';

const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT = 64_000;
const TYPES: Record<string, string> = {
  'text/plain': '.txt', 'text/markdown': '.md', 'text/csv': '.csv', 'application/json': '.json',
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/x-ipynb+json': '.ipynb',
};
type Python = <T>(script: string, payload?: unknown) => Promise<T>;

export async function supportsHermesDocuments(runPython: Python): Promise<boolean> {
  try {
    return await runPython<boolean>([
      'import importlib.util, json',
      'from tools.read_extract import extract_document_bytes',
      'print(json.dumps(importlib.util.find_spec("anydoc") is not None))',
    ].join('\n')) === true;
  } catch { return false; }
}

/** Native extraction in private temporary files; no arbitrary paths, tool execution or lazy installs. */
export async function prepareHermesDocuments(attachments: unknown, runPython: Python): Promise<{ images: unknown[]; appendix: string }> {
  if (attachments === undefined) return { images: [], appendix: '' };
  if (!Array.isArray(attachments) || attachments.length > 6) throw new Error('At most six attachments are supported.');
  let bytes = 0; let characters = 0;
  const images: unknown[] = []; const documents: Array<{ name: string; text: string }> = [];
  for (const item of attachments) {
    if (!isRecord(item)) throw new Error('Invalid attachment.');
    const mimeType = readString(item.mimeType).toLowerCase();
    const content = readString(item.content);
    if (!content || content.length > Math.ceil(MAX_BYTES / 3) * 4 || content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(content)) throw new Error('Invalid attachment data.');
    const decoded = Buffer.from(content, 'base64');
    if (!decoded.length || decoded.toString('base64') !== content || (bytes += decoded.length) > MAX_BYTES) throw new Error('Attachments exceed 5 MiB.');
    if (mimeType.startsWith('image/')) { images.push(item); continue; }
    if (item.type !== 'file' || !TYPES[mimeType]) throw new Error('This document type is not supported.');
    const extension = TYPES[mimeType];
    const name = (readString(item.name) || readString(item.fileName) || `document${extension}`).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200);
    let text: string;
    if (extension === '.txt' || extension === '.md' || extension === '.csv' || extension === '.json') {
      text = new TextDecoder('utf-8', { fatal: true }).decode(decoded);
      if (text.includes('\0')) throw new Error('The document is not UTF-8 text.');
    } else {
      text = await runPython<string>([
        'import base64, contextlib, importlib, io, json, sys, zipfile',
        'from tools import read_extract',
        'payload = json.load(sys.stdin)',
        'data = base64.b64decode(payload["content"], validate=True)',
        'if len(data) > 5 * 1024 * 1024: raise ValueError("Document too large")',
        'if payload["extension"] in (".docx", ".xlsx"):',
        '  with zipfile.ZipFile(io.BytesIO(data)) as archive:',
        '    items = archive.infolist()',
        '    if len(items) > 512 or sum(item.file_size for item in items) > 32 * 1024 * 1024: raise ValueError("Expanded document too large")',
        '# Import only an already installed converter. Never trigger native lazy installation.',
        'read_extract._anydoc_module = importlib.import_module("anydoc")',
        'with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):',
        '  text = read_extract.extract_document_bytes(data, "document" + payload["extension"])',
        'if not isinstance(text, str) or len(text) > 64000: raise ValueError("Extracted document too long")',
        'print(json.dumps(text))',
      ].join('\n'), { content, extension });
    }
    if (typeof text !== 'string' || !text.trim() || (characters += text.length) > MAX_TEXT) throw new Error('The document has no readable text or exceeds the text limit.');
    documents.push({ name, text });
  }
  // JSON keeps filenames/content from forging extra structured envelope fields.
  return { images, appendix: documents.length ? `\n\n<clawket-document-context>\n${JSON.stringify(documents)}\n</clawket-document-context>` : '' };
}
