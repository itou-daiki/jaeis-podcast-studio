import type { Candidate, Placement, Track } from "./types";

export const SAMPLE_RATE = 44100;
export const MAX_FILE_BYTES = 350 * 1024 * 1024;
export const MAX_PCM_BYTES = 850 * 1024 * 1024;
export const colors = ["#177f79", "#5263b6", "#ab6387", "#b07831"];
let context: AudioContext | undefined;
export function audioContext() {
  return (context ??= new AudioContext({ sampleRate: SAMPLE_RATE }));
}

export async function decode(
  file: File,
  status: (message: string) => void,
): Promise<AudioBuffer> {
  if (file.size > MAX_FILE_BYTES)
    throw new Error(
      "1ファイル350 MBまでです。長いZoom録画は音声のみ（M4A）で取り込んでください。",
    );
  status(`${file.name} の音声を読み込んでいます…`);
  let buffer: AudioBuffer;
  try {
    buffer = await audioContext().decodeAudioData(await file.arrayBuffer());
  } catch {
    status("この形式の音声をブラウザ内で変換しています…");
    const { convertMedia } = await import("./conversion");
    const wav = await convertMedia(
      new Uint8Array(await file.arrayBuffer()),
      "extract",
      false,
      status,
    );
    buffer = await audioContext().decodeAudioData(wav.buffer as ArrayBuffer);
  }
  if (buffer.duration > 45 * 60)
    throw new Error(
      "この版は1ファイル45分までです。分割して編集してください。",
    );
  if (buffer.numberOfChannels > 2)
    throw new Error("モノラルまたはステレオの録音を選んでください。");
  return buffer;
}

export async function analyze(buffer: AudioBuffer) {
  const block = Math.round(buffer.sampleRate * 0.05);
  const count = Math.ceil(buffer.length / block);
  const peaks = new Float32Array(count),
    rms = new Float32Array(count);
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) =>
    buffer.getChannelData(i),
  );
  for (let b = 0; b < count; b++) {
    let sum = 0,
      peak = 0,
      n = 0;
    for (let i = b * block; i < Math.min((b + 1) * block, buffer.length); i++) {
      for (const channel of channels) {
        const v = channel[i];
        peak = Math.max(peak, Math.abs(v));
        sum += v * v;
        n++;
      }
    }
    peaks[b] = peak;
    rms[b] = Math.sqrt(sum / Math.max(1, n));
    if (b % 1200 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return { peaks, rms };
}

export function silenceCandidates(
  tracks: Track[],
  duration: number,
  thresholdDb = -45,
  minSeconds = 2,
): Candidate[] {
  const active = tracks.filter((t) => !t.muted);
  if (!active.length) return [];
  const result: Candidate[] = [];
  const threshold = 10 ** (thresholdDb / 20);
  let start: number | null = null;
  const flush = (end: number) => {
    if (start !== null && end - start >= minSeconds) {
      // Keep 250 ms on both sides; never remove the entire pause.
      result.push({
        id: `silence-${start.toFixed(2)}-${end.toFixed(2)}`,
        start: start + 0.25,
        end: end - 0.25,
        kind: "silence",
        reason: "長い静かな区間",
        detail: `全ての有効な声トラックが ${thresholdDb} dBFS 未満です。小声・息継ぎも含み得るため、試聴して判断してください。`,
      });
    }
    start = null;
  };
  for (let i = 0; i < Math.ceil(duration / 0.05); i++) {
    const t = i * 0.05;
    const quiet = active.every((track) => {
      const index = Math.floor((t - track.offset) / 0.05);
      return (
        index < 0 ||
        index >= track.rms.length ||
        track.rms[index] * 10 ** (track.gainDb / 20) < threshold
      );
    });
    if (quiet && start === null) start = t;
    if (!quiet) flush(t);
  }
  flush(duration);
  return result;
}

export function schedule(
  ctx: BaseAudioContext,
  placements: Placement[],
  from: number,
  until: number,
  when: number,
) {
  const sources: AudioBufferSourceNode[] = [];
  for (const p of placements) {
    const start = Math.max(p.when, from),
      end = Math.min(p.when + p.duration, until);
    if (end <= start) continue;
    const source = ctx.createBufferSource(),
      gain = ctx.createGain();
    source.buffer = p.buffer;
    source.connect(gain);
    gain.connect(ctx.destination);
    const at = when + start - from,
      length = end - start,
      fade = Math.min(p.fade, length / 3);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(p.gain, at + fade);
    gain.gain.setValueAtTime(p.gain, at + length - fade);
    gain.gain.linearRampToValueAtTime(0, at + length);
    source.start(at, p.offset + start - p.when, length);
    sources.push(source);
  }
  return sources;
}

export async function render(
  placements: Placement[],
  duration: number,
  rate = SAMPLE_RATE,
  channels = 2,
): Promise<AudioBuffer> {
  if (!Number.isFinite(duration) || duration <= 0)
    throw new Error("書き出す音声がありません。");
  if (duration * rate * channels * 4 > 650 * 1024 * 1024)
    throw new Error(
      "書き出しサイズが大きすぎます。短い範囲に分けるか音楽を減らしてください。",
    );
  const ctx = new OfflineAudioContext(
    channels,
    Math.ceil(duration * rate),
    rate,
  );
  schedule(ctx, placements, 0, duration, 0);
  return ctx.startRendering();
}

export async function encodeWav(
  buffer: AudioBuffer,
): Promise<Uint8Array<ArrayBuffer>> {
  const channels = buffer.numberOfChannels;
  const data = new ArrayBuffer(44 + buffer.length * channels * 2),
    view = new DataView(data);
  const text = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++)
      view.setUint8(offset + i, s.charCodeAt(i));
  };
  text(0, "RIFF");
  view.setUint32(4, data.byteLength - 8, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, buffer.sampleRate, true);
  view.setUint32(28, buffer.sampleRate * channels * 2, true);
  view.setUint16(32, channels * 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, data.byteLength - 44, true);
  const arrays = Array.from({ length: channels }, (_, i) =>
    buffer.getChannelData(i),
  );
  for (let i = 0; i < buffer.length; i++) {
    for (let ch = 0; ch < channels; ch++) {
      const value = Math.max(-1, Math.min(1, arrays[ch][i]));
      view.setInt16(
        44 + (i * channels + ch) * 2,
        Math.round(value * (value < 0 ? 32768 : 32767)),
        true,
      );
    }
    if (i % 1000000 === 0) await new Promise((r) => setTimeout(r, 0));
  }
  return new Uint8Array(data);
}

export function download(data: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([data], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}
