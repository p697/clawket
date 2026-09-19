import { describe, expect, it } from 'vitest';
import { finishTask, MAX_AUDIO_BYTES, runTask, Transcript } from './provider';
const event = (id: number, text: string, final = false) => JSON.stringify({ header: { task_id: 'task', event: 'result-generated' }, payload: { output: { sentence: { sentence_id: id, text, sentence_end: final } } } });
describe('Alibaba streaming protocol', () => {
  it('uses fixed PCM/model configuration without user-supplied context', () => {
    expect(runTask('task').payload.parameters).toMatchObject({ format: 'pcm', sample_rate: 16000 });
    expect(runTask('task').payload.input).toEqual({});
    expect(finishTask('task').header.action).toBe('finish-task'); expect(MAX_AUDIO_BYTES).toBe(3840000);
  });
  it('revises sentences without repeating partial text or losing final sentences', () => {
    const transcript = new Transcript();
    transcript.accept(event(0, 'Hel'), 'task'); transcript.accept(event(0, 'Hello.', true), 'task');
    transcript.accept(event(0, 'stale'), 'task'); transcript.accept(event(2, 'world', true), 'task');
    expect(transcript.text).toBe('Hello.world');
  });
  it('rejects malformed, oversized and wrong-task messages', () => {
    for (const data of ['null', '{', event(-1, 'bad'), event(1, 'a'.repeat(8001)), JSON.stringify({ header: { task_id: 'other' } })]) {
      expect(() => new Transcript().accept(data, 'task')).toThrow();
    }
  });
});
