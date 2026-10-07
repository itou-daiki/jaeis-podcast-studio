import type { Cut, Cue } from "./types";
import { validateCues } from "./transcript";

type SavedTrack = {
  name: string;
  size: number;
  lastModified: number;
  gainDb: number;
  offset: number;
  muted: boolean;
};
type SavedMusic = {
  name: string;
  duration: number;
  role: "opening" | "ending" | "jingle";
  at: number;
  gainDb: number;
};
export type Project = {
  version: 1;
  title: string;
  cuts: Cut[];
  cues: Cue[];
  tracks: SavedTrack[];
  music: SavedMusic[];
};
export const saveProject = (project: Project) =>
  JSON.stringify(project, null, 2);

// Consume matches: two uses of one music file require two loaded clips.
export function missingSources(
  project: Project,
  tracks: Pick<SavedTrack, "name" | "size" | "lastModified">[],
  music: Pick<SavedMusic, "name" | "duration">[],
) {
  const voices = [...tracks],
    clips = [...music];
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
      .filter((s) => {
        const i = clips.findIndex(
          (m) => m.name === s.name && Math.abs(m.duration - s.duration) < 0.01,
        );
        if (i < 0) return true;
        clips.splice(i, 1);
        return false;
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
      typeof t.muted !== "boolean"
    )
      throw new Error("素材の設定が正しくありません。");
  for (const m of p.music)
    if (
      !m ||
      typeof m.name !== "string" ||
      !["opening", "ending", "jingle"].includes(m.role) ||
      !finite(m.duration, 0, 2700) ||
      !finite(m.at, 0, 86400) ||
      !finite(m.gainDb, -60, 12)
    )
      throw new Error("音楽の設定が正しくありません。");
  return {
    version: 1,
    title: p.title.slice(0, 200),
    cuts: p.cuts.map((c: Cut) => ({
      id: c.id,
      start: c.start,
      end: c.end,
      reason: c.reason,
    })),
    tracks: p.tracks,
    music: p.music,
    cues: validateCues(p.cues),
  };
}
