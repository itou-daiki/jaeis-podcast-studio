import type { buildPlacements } from "./editing";
import { encodeWav, render } from "./media";

export async function renderExport(
  plan: ReturnType<typeof buildPlacements>,
  format: "wav" | "mp3",
  normalize: boolean,
  status: (value: string) => void,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  status("カットと音楽を反映しています…");
  const buffer = await render(plan.placements, plan.duration);
  signal?.throwIfAborted();
  let peak = 0;
  for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
    const samples = buffer.getChannelData(ch);
    for (let i = 0; i < samples.length; i++)
      peak = Math.max(peak, Math.abs(samples[i]));
  }
  if (peak > 0.98)
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
      const samples = buffer.getChannelData(ch);
      for (let i = 0; i < samples.length; i++) samples[i] *= 0.98 / peak;
    }
  status("WAVデータを作成しています…");
  let bytes = await encodeWav(buffer);
  signal?.throwIfAborted();
  if (format === "mp3" || normalize) {
    const { convertMedia } = await import("./conversion");
    bytes = await convertMedia(bytes, format, normalize, status, signal);
  }
  signal?.throwIfAborted();
  return bytes;
}
