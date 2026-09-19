/** Streaming box-filter resampler. Hardware rates (including Bluetooth) are not assumed. */
export class SpeechPcm {
  private filled = 0;
  private weighted = 0;
  private rate = 0;
  convert(data: ArrayBuffer, sampleRate: number, channels: number): Uint8Array {
    if (
      !Number.isFinite(sampleRate) ||
      sampleRate < 8000 ||
      sampleRate > 192000 ||
      !Number.isInteger(channels) ||
      channels < 1 ||
      channels > 8 ||
      data.byteLength % (4 * channels)
    )
      throw new Error('speech_audio_format');
    if (this.rate && this.rate !== sampleRate) {
      this.filled = 0;
      this.weighted = 0;
    }
    this.rate = sampleRate;
    const samples = new Float32Array(data),
      ratio = sampleRate / 16000;
    const out: number[] = [];
    for (let i = 0; i < samples.length; i += channels) {
      let mono = 0;
      for (let c = 0; c < channels; c++) mono += samples[i + c]! / channels;
      if (!Number.isFinite(mono)) mono = 0;
      let remaining = 1;
      while (remaining > 1e-9) {
        const take = Math.min(remaining, ratio - this.filled);
        this.weighted += mono * take;
        this.filled += take;
        remaining -= take;
        if (this.filled >= ratio - 1e-9) {
          const value = Math.max(-1, Math.min(1, this.weighted / ratio));
          out.push(Math.round(value * (value < 0 ? 32768 : 32767)));
          this.filled = 0;
          this.weighted = 0;
        }
      }
    }
    const bytes = new Uint8Array(out.length * 2),
      view = new DataView(bytes.buffer);
    out.forEach((value, i) => view.setInt16(i * 2, value, true));
    return bytes;
  }
}
