import type { Cut, Range, Segment, Track, MusicClip, Placement } from "./types";

export function applyCutRange(cuts: Cut[], cut: Cut, duration: number): Cut[] {
  if (
    !Number.isFinite(duration) ||
    !Number.isFinite(cut.start) ||
    !Number.isFinite(cut.end) ||
    cut.start < 0 ||
    cut.end > duration ||
    cut.end - cut.start < 0.03 - 1e-9
  )
    throw new Error(
      "カットの開始・終了を確認してください。長さは0.03秒以上にしてください。",
    );
  return cuts.some((c) => c.id === cut.id)
    ? cuts.map((c) =>
        c.id === cut.id ? { ...c, start: cut.start, end: cut.end } : c,
      )
    : [...cuts, { ...cut }];
}

export function normalizeCuts(cuts: Range[], duration: number): Range[] {
  if (!Number.isFinite(duration) || duration <= 0) return [];
  const valid = cuts
    .filter((c) => Number.isFinite(c.start) && Number.isFinite(c.end))
    .map((c) => ({
      start: Math.max(0, c.start),
      end: Math.min(duration, c.end),
    }))
    .filter((c) => c.end > c.start)
    .sort((a, b) => a.start - b.start);
  const result: Range[] = [];
  for (const cut of valid) {
    const last = result.at(-1);
    if (last && cut.start <= last.end) last.end = Math.max(last.end, cut.end);
    else result.push({ ...cut });
  }
  return result;
}

export function buildSegments(duration: number, cuts: Range[]): Segment[] {
  const segments: Segment[] = [];
  let cursor = 0,
    outputStart = 0;
  for (const cut of [
    ...normalizeCuts(cuts, duration),
    { start: duration, end: duration },
  ]) {
    if (cut.start > cursor) {
      segments.push({ start: cursor, end: cut.start, outputStart });
      outputStart += cut.start - cursor;
    }
    cursor = cut.end;
  }
  return segments;
}

export function sourceToOutput(time: number, mapping: Segment[]): number {
  for (const s of mapping) {
    if (time < s.start) return s.outputStart;
    if (time < s.end) return s.outputStart + time - s.start;
  }
  const last = mapping.at(-1);
  return last ? last.outputStart + last.end - last.start : 0;
}

export function outputToSource(time: number, mapping: Segment[]): number {
  for (const s of mapping) {
    if (time < s.outputStart) return s.start;
    if (time < s.outputStart + s.end - s.start)
      return s.start + time - s.outputStart;
  }
  return mapping.at(-1)?.end ?? 0;
}

export function buildPlacements(
  tracks: Pick<Track, "buffer" | "offset" | "muted" | "gainDb">[],
  segments: Segment[],
  music: MusicClip[],
): { placements: Placement[]; mapping: Segment[]; duration: number } {
  const placements: Placement[] = [],
    mapping: Segment[] = [];
  let cursor = 0;
  const addMusic = (clip: MusicClip) => {
    placements.push({
      buffer: clip.buffer,
      when: cursor,
      offset: 0,
      duration: clip.buffer.duration,
      gain: 10 ** (clip.gainDb / 20),
      fade: 0.05,
    });
    cursor += clip.buffer.duration;
  };
  music.filter((m) => m.role === "opening").forEach(addMusic);
  const jingles = music
    .filter((m) => m.role === "jingle")
    .sort((a, b) => a.at - b.at);
  let index = 0;
  for (const segment of segments) {
    let from = segment.start;
    while (index < jingles.length && jingles[index].at < segment.end) {
      const until = Math.max(from, jingles[index].at);
      if (until > from) {
        mapping.push({ start: from, end: until, outputStart: cursor });
        cursor += until - from;
      }
      addMusic(jingles[index++]);
      from = until;
    }
    if (segment.end > from) {
      mapping.push({ start: from, end: segment.end, outputStart: cursor });
      cursor += segment.end - from;
    }
  }
  while (index < jingles.length) addMusic(jingles[index++]);
  music.filter((m) => m.role === "ending").forEach(addMusic);
  for (const track of tracks.filter((t) => !t.muted)) {
    for (const s of mapping) {
      const start = Math.max(s.start, track.offset),
        end = Math.min(s.end, track.offset + track.buffer.duration);
      if (end > start)
        placements.push({
          buffer: track.buffer,
          when: s.outputStart + start - s.start,
          offset: start - track.offset,
          duration: end - start,
          gain: 10 ** (track.gainDb / 20),
          fade: 0.005,
        });
    }
  }
  return { placements, mapping, duration: cursor };
}

export function formatTime(time: number, precise = false): string {
  const safe = Math.max(0, Number.isFinite(time) ? time : 0);
  const ms = Math.round(safe * 1000);
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor(ms / 1000) % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}${precise ? "." + String(ms % 1000).padStart(3, "0") : ""}`;
}
