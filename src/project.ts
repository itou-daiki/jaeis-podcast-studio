import type { Cut, Cue, MusicClip } from "./types";
import { validateCues } from "./transcript";
import { MAX_SCRIPT_LENGTH } from "./speakers";
import { isVoiceSettings, type VoiceSettings } from "./voice";
import { findBuiltInMusic } from "./music-catalog";

export type SavedScript = { text: string; name?: string };

type SavedTrack = {
  name: string;
  size: number;
  lastModified: number;
  gainDb: number;
  offset: number;
  muted: boolean;
  voice?: VoiceSettings;
};
export type SavedMusic = {
  name: string;
  duration: number;
  role: MusicClip["role"];
  at: number;
  gainDb: number;
  assetId?: string;
  scriptJingleKey?: string;
  builtinId?: string;
};
export type Project = {
  version: 1;
  title: string;
  cuts: Cut[];
  cues: Cue[];
  tracks: SavedTrack[];
  music: SavedMusic[];
  script?: SavedScript;
};
export const saveProject = (project: Project) =>
  // Keep session-only settings (especially credentials and undo buffers) out of persistence.
  JSON.stringify(
    {
      version: project.version,
      title: project.title,
      cuts: project.cuts,
      cues: project.cues,
      tracks: project.tracks,
      music: project.music,
      ...(project.script ? { script: project.script } : {}),
    },
    null,
    2,
  );

// Legacy clips consume distinct files; explicit shared assets reuse one decode.
export function musicSourceIndices(
  saved: SavedMusic[],
  loaded: { name: string; duration: number }[],
): number[] {
  const used = new Set<number>();
  const shared = new Map<string, number>();
  return saved.map((s) => {
    if (s.builtinId) return -1; // Resolved by the built-in library, not uploads.
    if (s.assetId && shared.has(s.assetId)) return shared.get(s.assetId)!;
    const index = loaded.findIndex(
      (m, i) =>
        !used.has(i) &&
        m.name === s.name &&
        Math.abs(m.duration - s.duration) < 0.01,
    );
    if (index >= 0) used.add(index);
    if (s.assetId) shared.set(s.assetId, index);
    return index;
  });
}

export function missingSources(
  project: Project,
  tracks: Pick<SavedTrack, "name" | "size" | "lastModified">[],
  music: Pick<SavedMusic, "name" | "duration">[],
) {
  const voices = [...tracks];
  const indices = musicSourceIndices(project.music, music);
  const missingAssets = new Set<string>();
  return {
    voices: project.tracks
      .filter((s) => {
        const i = voices.findIndex(
          (t) =>
            t.name === s.name &&
            t.size === s.size &&
            t.lastModified === s.lastModified,
        );
        if (i < 0) return true;
        voices.splice(i, 1);
        return false;
      })
      .map((s) => s.name),
    music: project.music
      .filter((s, i) => {
        if (findBuiltInMusic(s.builtinId)) return false;
        if (indices[i] >= 0 || (s.assetId && missingAssets.has(s.assetId)))
          return false;
        if (s.assetId) missingAssets.add(s.assetId);
        return true;
      })
      .map((s) => s.name),
  };
}
export function readProject(text: string): Project {
  if (text.length > 10000000)
    throw new Error("プロジェクトファイルが大きすぎます。");
  const p = JSON.parse(text);
  const finite = (x: unknown, min: number, max: number) =>
    typeof x === "number" && Number.isFinite(x) && x >= min && x <= max;
  const array = (x: unknown, max: number) =>
    Array.isArray(x) && x.length <= max;
  if (
    !p ||
    p.version !== 1 ||
    typeof p.title !== "string" ||
    !array(p.cuts, 10000) ||
    !array(p.tracks, 12) ||
    !array(p.music, 100)
  )
    throw new Error("対応していないプロジェクト形式です。");
  for (const c of p.cuts)
    if (
      !c ||
      typeof c.id !== "string" ||
      typeof c.reason !== "string" ||
      !finite(c.start, 0, 86400) ||
      !finite(c.end, c.start + 0.000001, 86400)
    )
      throw new Error("カット範囲が正しくありません。");
  for (const t of p.tracks)
    if (
      !t ||
      typeof t.name !== "string" ||
      !finite(t.size, 0, 2 ** 40) ||
      !finite(t.lastModified, 0, 2 ** 53 - 1) ||
      !finite(t.gainDb, -60, 24) ||
      !finite(t.offset, -3600, 3600) ||
      typeof t.muted !== "boolean" ||
      (t.voice !== undefined && !isVoiceSettings(t.voice))
    )
      throw new Error("素材の設定が正しくありません。");
  for (const m of p.music)
    if (
      !m ||
      typeof m.name !== "string" ||
      !["opening", "ending", "jingle", "bgm"].includes(m.role) ||
      !finite(m.duration, 0, 2700) ||
      !finite(m.at, 0, 86400) ||
      !finite(m.gainDb, -60, 12) ||
      (m.builtinId !== undefined &&
        (!findBuiltInMusic(m.builtinId) ||
          Math.abs(findBuiltInMusic(m.builtinId)!.seconds - m.duration) >
            0.01)) ||
      (m.assetId !== undefined &&
        (typeof m.assetId !== "string" ||
          !m.assetId.length ||
          m.assetId.length > 100)) ||
      (m.scriptJingleKey !== undefined &&
        (typeof m.scriptJingleKey !== "string" ||
          !m.scriptJingleKey.length ||
          m.scriptJingleKey.length > 2000))
    )
      throw new Error("音楽の設定が正しくありません。");
  if (p.music.filter((m: SavedMusic) => m.role === "bgm").length > 1)
    throw new Error("BGMは1曲までです。");
  const assets = new Map<string, SavedMusic>();
  for (const m of p.music as SavedMusic[]) {
    if (!m.assetId) continue;
    const prior = assets.get(m.assetId);
    if (
      prior &&
      (prior.name !== m.name ||
        prior.builtinId !== m.builtinId ||
        Math.abs(prior.duration - m.duration) >= 0.01)
    )
      throw new Error("共有する音楽素材の情報が一致しません。");
    assets.set(m.assetId, m);
  }
  if (
    p.script !== undefined &&
    (!p.script ||
      typeof p.script.text !== "string" ||
      p.script.text.length > MAX_SCRIPT_LENGTH ||
      (p.script.name !== undefined && typeof p.script.name !== "string"))
  )
    throw new Error("原稿の形式を確認してください（10万文字まで）。");
  return {
    version: 1,
    title: p.title.slice(0, 200),
    cuts: p.cuts.map((c: Cut) => ({
      id: c.id,
      start: c.start,
      end: c.end,
      reason: c.reason,
    })),
    tracks: p.tracks.map((t: SavedTrack) => ({
      name: t.name,
      size: t.size,
      lastModified: t.lastModified,
      gainDb: t.gainDb,
      offset: t.offset,
      muted: t.muted,
      ...(t.voice
        ? {
            voice: {
              noise: t.voice.noise,
              rumble: t.voice.rumble,
              compress: t.voice.compress,
            },
          }
        : {}),
    })),
    music: p.music.map((m: SavedMusic) => ({
      name: m.name,
      duration: m.duration,
      role: m.role,
      at: m.at,
      gainDb: m.gainDb,
      ...(m.assetId ? { assetId: m.assetId } : {}),
      ...(m.builtinId ? { builtinId: m.builtinId } : {}),
      ...(m.scriptJingleKey ? { scriptJingleKey: m.scriptJingleKey } : {}),
    })),
    cues: validateCues(p.cues),
    ...(p.script
      ? {
          script: {
            text: p.script.text,
            ...(p.script.name !== undefined
              ? { name: p.script.name.slice(0, 200) }
              : {}),
          },
        }
      : {}),
  };
}
