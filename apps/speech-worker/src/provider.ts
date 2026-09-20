import { providerFailure } from './diagnostics';
/** Alibaba Cloud's duplex task protocol. No chat content is sent as context. */
export const SPEECH_MODEL = 'qwen-audio-3.0-asr-flash-streaming';
export const MAX_SECONDS = 120;
export const MAX_AUDIO_BYTES = MAX_SECONDS * 32000;
export function runTask(id: string) {
  return {
    header: { action: 'run-task', task_id: id, streaming: 'duplex' },
    payload: {
      task_group: 'audio', task: 'asr', function: 'recognition', model: SPEECH_MODEL,
      parameters: { format: 'pcm', sample_rate: 16000, max_sentence_silence: 600, semantic_punctuation_enabled: false },
      input: {},
    },
  };
}
export function finishTask(id: string) {
  return { header: { action: 'finish-task', task_id: id, streaming: 'duplex' }, payload: { input: {} } };
}
export class Transcript {
  private sentences = new Map<number, { text: string; final: boolean }>();
  accept(raw: string, taskId: string): 'started' | 'text' | 'finished' | 'ignore' {
    if (raw.length > 32768) throw Error('speech_protocol');
    const event = JSON.parse(raw);
    if (!event || event.header?.task_id !== taskId) throw Error('speech_protocol');
    switch (event.header.event) {
      case 'task-started': return 'started';
      case 'task-finished': return 'finished';
      case 'task-failed': throw Error(providerFailure(event.header.error_code));
      case 'result-generated': break;
      default: return 'ignore';
    }
    const sentence = event.payload?.output?.sentence;
    if (!sentence || sentence.heartbeat) return 'ignore';
    if (!Number.isInteger(sentence.sentence_id) || sentence.sentence_id < 0 ||
        typeof sentence.text !== 'string' || sentence.text.length > 8000 || this.sentences.size > 400) {
      throw Error('speech_protocol');
    }
    const previous = this.sentences.get(sentence.sentence_id);
    if (!previous?.final || sentence.sentence_end === true) {
      this.sentences.set(sentence.sentence_id, { text: sentence.text, final: sentence.sentence_end === true });
    }
    if (this.text.length > 16000) throw Error('speech_too_long');
    return 'text';
  }
  get text(): string {
    return [...this.sentences].sort(([a], [b]) => a - b).map(([, s]) => s.text).join('').trim();
  }
}
