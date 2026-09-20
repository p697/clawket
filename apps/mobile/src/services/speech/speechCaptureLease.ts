import { SpeechError } from './speechErrors';

/** Audio sessions are process-global, even when navigation mounts two chat hooks. */
export class CaptureLease {
  private tail: Promise<void> = Promise.resolve();
  async acquire(signal: AbortSignal): Promise<() => void> {
    const previous = this.tail;
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    this.tail = previous.then(() => held);
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(new SpeechError('speech_cancelled')); });
    signal.addEventListener('abort', abort);
    try {
      if (signal.aborted) throw new SpeechError('speech_cancelled');
      await Promise.race([previous, cancelled]);
      if (signal.aborted) throw new SpeechError('speech_cancelled');
      return release;
    } catch (error) { release(); throw error; }
    finally { signal.removeEventListener('abort', abort); }
  }
}
export const speechCaptureLease = new CaptureLease();
