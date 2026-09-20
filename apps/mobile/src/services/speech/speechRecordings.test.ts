import { createRecording, savedRecordings, SpeechRecording, RECORDING_SECONDS } from './speechRecordings';
// Real local file operations exercise restart recovery and atomic result replacement.
jest.mock('expo-file-system', () => {
  const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'clawket-voice-store-'));
  class Entry {
    uri: string;
    constructor(...parts: any[]) { this.uri = path.join(...parts.map(p => typeof p === 'string' ? p : p.uri)); }
    get name() { return path.basename(this.uri); }
    get exists() { return fs.existsSync(this.uri); }
    get size() { return this.exists ? fs.statSync(this.uri).size : 0; }
    delete() { fs.rmSync(this.uri, { recursive: true }); }
  }
  class File extends Entry {
    create() { fs.writeFileSync(this.uri, ''); }
    write(value: string) { fs.writeFileSync(this.uri, value); }
    textSync() { return fs.readFileSync(this.uri, 'utf8'); }
    moveSync(other: Entry) { fs.renameSync(this.uri, other.uri); this.uri = other.uri; }
    open(mode: string) {
      const fd = fs.openSync(this.uri, mode === 'r' ? 'r' : 'a+');
      return { offset: 0, close: () => fs.closeSync(fd), writeBytes: (bytes: Uint8Array) => { fs.writeSync(fd, bytes); },
        readBytes(length: number) { const bytes = Buffer.alloc(length); const n = fs.readSync(fd, bytes, 0, length, this.offset); this.offset += n; return new Uint8Array(bytes.subarray(0, n)); } };
    }
  }
  class Directory extends Entry {
    create() { fs.mkdirSync(this.uri, { recursive: true }); }
    list() { return fs.readdirSync(this.uri).map((name: string) => fs.statSync(path.join(this.uri, name)).isDirectory() ? new Directory(this, name) : new File(this, name)); }
  }
  return { File, Directory, FileMode: { Append: 'wa', ReadOnly: 'r' }, Paths: { document: root }, _root: root };
});
jest.mock('../gateway-auth', () => ({ generateId: () => require('node:crypto').randomBytes(16).toString('hex') }));
const fs = require('node:fs'), path = require('node:path');
const root = jest.requireMock('expo-file-system')._root;
afterEach(() => { fs.rmSync(path.join(root, 'voice-drafts-v1'), { recursive: true, force: true }); });
afterAll(() => { fs.rmSync(root, { recursive: true, force: true }); });
describe('voice journals on disk', () => {
  it('recovers all committed bytes across a new instance and keeps backend/session scopes isolated', () => {
    const recording = createRecording('openclaw:main', 'original draft');
    recording.append(new Uint8Array([1, 2, 3, 4])); recording.append(new Uint8Array([5, 6])); recording.close();
    const restored = savedRecordings('openclaw:main')[0]!;
    expect(restored).not.toBe(recording); expect(restored.bytes).toBe(6);
    expect([...restored.read(0, 6)]).toEqual([1, 2, 3, 4, 5, 6]); expect(restored.metadata.draft).toBe('original draft');
    expect(savedRecordings('hermes:main')).toEqual([]);
  });
  it('keeps completed segment checkpoints after restart and ignores a torn temporary write', () => {
    const recording = createRecording('hermes:main', ''); recording.append(new Uint8Array(6)); recording.close();
    recording.checkpoint(0, 'first');
    const directory = path.join(root, 'voice-drafts-v1', recording.metadata.id);
    fs.writeFileSync(path.join(directory, 'result-1.tmp'), '{');
    const restored = new SpeechRecording(recording.metadata);
    expect(restored.result(0)).toBe('first'); expect(restored.result(1)).toBeNull();
    fs.writeFileSync(path.join(directory, 'result-0.json'), '{}'); expect(restored.result(0)).toBeNull();
    expect(restored.bytes).toBe(6);
  });
  it('fails closed on corrupt metadata and never deletes its source audio', () => {
    const recording = createRecording('scope', ''); recording.append(new Uint8Array(6)); recording.close();
    const directory = path.join(root, 'voice-drafts-v1', recording.metadata.id);
    fs.writeFileSync(path.join(directory, 'metadata.json'), '{');
    expect(savedRecordings('scope')).toEqual([]); expect(fs.existsSync(path.join(directory, 'audio.pcm'))).toBe(true);
  });
  it('bounds recordings without evicting old audio and removes only an explicitly discarded recording', () => {
    const all = Array.from({ length: 10 }, (_, i) => { const r = createRecording(`scope${i}`, ''); r.append(new Uint8Array(2)); r.close(); return r; });
    expect(() => createRecording('new', '')).toThrow('speech_storage_full');
    all[0]!.discard(); expect(savedRecordings('scope1')).toHaveLength(1); expect(() => createRecording('new', '')).not.toThrow();
  });
  it('rejects overlong and misaligned writes and out-of-range reads', () => {
    const r = createRecording('scope', '');
    expect(() => r.append(new Uint8Array(3))).toThrow('speech_storage');
    expect(() => r.append(new Uint8Array(RECORDING_SECONDS * 32000 + 2))).toThrow('speech_storage');
    expect(() => r.read(-1, 2)).toThrow('speech_storage');
  });
});
