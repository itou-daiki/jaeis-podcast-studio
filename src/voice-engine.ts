import { FFmpeg } from "@ffmpeg/ffmpeg";
import { hasVoiceEffects, isVoiceSettings, type VoiceSettings } from "./voice";
import type { Range } from "./types";

// Fixed noise floor makes separate chunks deterministic. No adaptive tracking:
// a new speech-heavy chunk must not be learned as background noise.
function filters(settings: VoiceSettings) {
  const nr = { off: 0, light: 6, standard: 10, strong: 16 }[settings.noise];
  return [
    settings.rumble ? "highpass=f=80" : "",
    nr ? `afftdn=nr=${nr}:nf=-50:gs=3` : "",
    settings.compress
      ? "acompressor=threshold=0.125:ratio=2:attack=20:release=250:makeup=1"
      : "",
  ]
    .filter(Boolean)
    .join(",");
}

/** Non-destructive, sample-aligned processing. Range is in source-buffer time. */
export async function processVoice(
  source: AudioBuffer,
  settings: VoiceSettings,
  status: (text: string) => void,
  signal: AbortSignal,
  range: Range = { start: 0, end: source.duration },
): Promise<AudioBuffer> {
  if (!isVoiceSettings(settings))
    throw new Error("音質調整の設定が正しくありません。");
  signal.throwIfAborted();
  const rate = source.sampleRate,
    channels = source.numberOfChannels;
  const first = Math.max(0, Math.round(range.start * rate));
  const last = Math.min(source.length, Math.round(range.end * rate));
  if (!Number.isFinite(first) || !Number.isFinite(last) || last <= first)
    throw new Error("試聴できる音声の範囲を選んでください。");
  if (!hasVoiceEffects(settings) && first === 0 && last === source.length)
    return source;
  const result = new AudioBuffer({
    numberOfChannels: channels,
    length: last - first,
    sampleRate: rate,
  });
  if (!hasVoiceEffects(settings)) {
    for (let c = 0; c < channels; c++)
      result.copyToChannel(source.getChannelData(c).subarray(first, last), c);
    return result;
  }
  const ffmpeg = new FFmpeg();
  const abort = () => ffmpeg.terminate();
  signal.addEventListener("abort", abort, { once: true });
  try {
    status("音質調整エンジンを読み込んでいます（初回 約32 MB）…");
    const base = new URL(import.meta.env.BASE_URL, location.origin);
    await ffmpeg.load({
      coreURL: new URL("vendor/ffmpeg-core.js", base).href,
      wasmURL: new URL("vendor/ffmpeg-core.wasm", base).href,
    });
    // Pinned core 0.12.10 (FFmpeg 5.1.4) afftdn delays output by two hops.
    // Align each padded input to the same FFT grid, warm up for >=1 second,
    // and read past the latency. Trailing padding retains the final samples.
    const hop = Math.floor(rate / 80);
    const latency = settings.noise === "off" ? 0 : 2 * hop;
    const chunkFrames = rate * 30;
    for (let start = first; start < last; start += chunkFrames) {
      signal.throwIfAborted();
      const end = Math.min(last, start + chunkFrames);
      const paddedStart = Math.floor((start - rate) / hop) * hop;
      const paddedEnd = end + rate;
      const input = new Float32Array((paddedEnd - paddedStart) * channels);
      for (let c = 0; c < channels; c++) {
        const samples = source.getChannelData(c);
        for (
          let i = Math.max(0, paddedStart);
          i < Math.min(source.length, paddedEnd);
          i++
        )
          input[(i - paddedStart) * channels + c] = samples[i];
      }
      status(
        `音質を調整しています… ${Math.round(((start - first) / (last - first)) * 100)}%`,
      );
      const expectedBytes = input.byteLength;
      await ffmpeg.writeFile("voice.raw", new Uint8Array(input.buffer));
      const code = await ffmpeg.exec(
        [
          "-f",
          "f32le",
          "-ar",
          String(rate),
          "-ac",
          String(channels),
          "-i",
          "voice.raw",
          "-af",
          filters(settings),
          "-f",
          "f32le",
          "adjusted.raw",
        ],
        120000,
      );
      signal.throwIfAborted();
      if (code !== 0)
        throw new Error(
          "音質調整に失敗しました。弱い設定や短い素材でお試しください。",
        );
      const bytes = await ffmpeg.readFile("adjusted.raw");
      if (typeof bytes === "string" || bytes.byteLength !== expectedBytes)
        throw new Error(
          "音質調整後の長さを確認できませんでした。原音は変更されていません。",
        );
      const output = new Float32Array(
        bytes.buffer,
        bytes.byteOffset,
        bytes.byteLength / 4,
      );
      const from = start - paddedStart + latency;
      for (let c = 0; c < channels; c++) {
        const samples = result.getChannelData(c);
        for (let i = 0; i < end - start; i++) {
          const value = output[(from + i) * channels + c];
          if (!Number.isFinite(value))
            throw new Error(
              "音質調整結果に異常があります。原音を保持しました。",
            );
          samples[start - first + i] = value;
        }
      }
      await ffmpeg.deleteFile("voice.raw");
      await ffmpeg.deleteFile("adjusted.raw");
    }
    return result;
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    signal.removeEventListener("abort", abort);
    ffmpeg.terminate();
  }
}
