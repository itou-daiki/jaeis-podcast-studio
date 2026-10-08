import { findBuiltInMusic } from "./music-catalog";
import { audioContext } from "./media";
import { musicSourceIndices, type SavedMusic } from "./project";
import type { MusicClip } from "./types";

const buffers = new Map<string, Promise<AudioBuffer>>();

export async function loadBuiltInMusic(
  id: string,
  context: BaseAudioContext = audioContext(),
): Promise<MusicClip> {
  const asset = findBuiltInMusic(id);
  if (!asset)
    throw new Error("この内蔵音源は見つかりません。アプリを更新してください。");
  let pending = buffers.get(id);
  if (!pending) {
    pending = (async () => {
      if (!asset.file) {
        const { createCalmLoop } = await import("./music-synthesis");
        return createCalmLoop(context);
      }
      const response = await fetch(
        `${import.meta.env.BASE_URL}music/${asset.file}`,
        { signal: AbortSignal.timeout(20000) },
      );
      if (!response.ok)
        throw new Error(
          "音源を取得できませんでした。通信状態を確認し、もう一度選んでください。",
        );
      const bytes = await response.arrayBuffer();
      if (bytes.byteLength > 5 * 1024 * 1024)
        throw new Error("内蔵音源のサイズが想定を超えています。");
      const buffer = await context.decodeAudioData(bytes);
      if (Math.abs(buffer.duration - asset.seconds) > 0.01)
        throw new Error(
          "内蔵音源の長さが一致しません。アプリを再読み込みしてください。",
        );
      return buffer;
    })();
    buffers.set(id, pending);
    pending.catch(() => buffers.delete(id)); // A failed fetch must remain retryable.
  }
  return {
    id: crypto.randomUUID(),
    assetId: `builtin:${id}`,
    builtinId: id,
    name: asset.name,
    buffer: await pending,
    role: asset.role,
    at: 0,
    gainDb: asset.gainDb,
  };
}

export async function restoreMusic(
  saved: SavedMusic[],
  loaded: MusicClip[],
  context: BaseAudioContext = audioContext(),
): Promise<MusicClip[]> {
  const indices = musicSourceIndices(
    saved,
    loaded.map((m) => ({ name: m.name, duration: m.buffer.duration })),
  );
  return Promise.all(
    saved.map(async (settings, i) => {
      const source = settings.builtinId
        ? await loadBuiltInMusic(settings.builtinId, context)
        : loaded[indices[i]];
      if (!source)
        throw new Error("保存時と同じ音楽ファイルも先に読み込んでください。");
      return { ...source, ...settings, id: crypto.randomUUID() };
    }),
  );
}
