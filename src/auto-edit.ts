import { normalizeCuts } from "./editing";
import type { JingleSuggestion } from "./jingles";
import type { Candidate, Cue, Cut, MusicClip, Range } from "./types";

export type AutoEditContext = {
  duration: number;
  cues: Cue[];
  cuts: Cut[];
  music: MusicClip[];
  jingleSource?: MusicClip;
  quiet: Range[];
  silences: Candidate[];
  markers: JingleSuggestion[];
};
export type AutoEditResult = {
  cuts: Cut[];
  music: MusicClip[];
  held: string[];
  summary: string;
  addedCuts: number;
  addedJingles: number;
};

const invalid = () =>
  new Error("AIの回答の形式・時刻を確認できません。編集は変更していません。");
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw invalid();
  return value as Record<string, unknown>;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value;
}
function index(value: unknown, max: number, min = 0): number {
  if (
    typeof value !== "number" ||
    !Number.isInteger(value) ||
    value < min ||
    value >= max
  )
    throw invalid();
  return value;
}
function confidence(value: unknown): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 1
  )
    throw invalid();
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== "string" || value.length > max) throw invalid();
  return value;
}
const overlaps = (a: Range, b: Range) => a.start < b.end && b.start < a.end;
const cutLength = (cuts: Cut[], duration: number) =>
  normalizeCuts(cuts, duration).reduce((sum, c) => sum + c.end - c.start, 0);

// External model output never supplies executable operations or arbitrary times.
// Only known transcript IDs and locally measured quiet ranges can become edits.
export function prepareAutoEdit(
  value: unknown,
  ctx: AutoEditContext,
): AutoEditResult {
  const p = record(value);
  if (
    !Number.isFinite(ctx.duration) ||
    ctx.duration <= 0 ||
    ctx.cues.some(
      (c, i) =>
        !Number.isFinite(c.start) ||
        !Number.isFinite(c.end) ||
        c.start < 0 ||
        c.end <= c.start ||
        c.end > ctx.duration ||
        (i > 0 && c.start < ctx.cues[i - 1].start),
    )
  )
    throw invalid();
  const requests = list(p.cuts, 500).map((item) => {
    const c = record(item);
    const first = index(c.first, ctx.cues.length),
      last = index(c.last, ctx.cues.length, first);
    if (c.kind !== "retake" && c.kind !== "setup") throw invalid();
    return {
      first,
      last,
      confidence: confidence(c.confidence),
      reason: text(c.reason, 300),
    };
  });
  const silenceIds = list(p.silenceIds, 2000).map((id) => {
    const found = ctx.silences.find((s) => s.id === id);
    if (!found) throw invalid();
    return found;
  });
  const jingles = list(p.jingles, 50).map((item) => {
    const j = record(item);
    return {
      marker: index(j.marker, ctx.markers.length),
      after: index(j.after, ctx.cues.length, -1),
      confidence: confidence(j.confidence),
    };
  });
  const summary = text(p.summary, 1200);
  const cuts = [...ctx.cuts],
    held: string[] = [];
  let music = [...ctx.music],
    addedJingles = 0;
  const baseline = cutLength(cuts, ctx.duration);
  const add = (cut: Cut) => {
    if (
      cuts.some(
        (c) => c.id === cut.id || (c.start <= cut.start && c.end >= cut.end),
      )
    )
      return;
    const total = cutLength([...cuts, cut], ctx.duration);
    if (total - baseline > ctx.duration * 0.3 || total > ctx.duration * 0.9) {
      held.push(`${cut.reason}：削除量が大きいため残しました。`);
    } else if (
      music.some(
        (m) => m.role === "jingle" && cut.start < m.at && m.at < cut.end,
      )
    ) {
      held.push(`${cut.reason}：配置済みジングルと重なるため残しました。`);
    } else cuts.push(cut);
  };
  function quietEdge(at: number, low: number, high: number) {
    const choices = ctx.quiet.flatMap((q) => {
      const start = Math.max(low, q.start, at - 1),
        end = Math.min(high, q.end, at + 1);
      return start <= end ? [Math.max(start, Math.min(end, at))] : [];
    });
    if (at <= 0.3 && low <= 0) choices.push(0);
    if (ctx.duration - at <= 0.3 && high >= ctx.duration)
      choices.push(ctx.duration);
    return choices.sort((a, b) => Math.abs(a - at) - Math.abs(b - at))[0];
  }
  for (const request of requests) {
    const first = ctx.cues[request.first],
      last = ctx.cues[request.last];
    const start = quietEdge(
      first.start,
      request.first ? ctx.cues[request.first - 1].end + 0.08 : 0,
      first.start + 0.15,
    );
    const end = quietEdge(
      last.end,
      last.end - 0.15,
      ctx.cues[request.last + 1]
        ? ctx.cues[request.last + 1].start - 0.08
        : ctx.duration,
    );
    if (
      request.confidence < 0.9 ||
      start === undefined ||
      end === undefined ||
      end <= start ||
      end - start > 120 ||
      ctx.cues.some(
        (cue, i) =>
          (i < request.first || i > request.last) &&
          overlaps(cue, { start, end }),
      )
    ) {
      held.push(
        `${request.reason}：確信度または音声の境目を確認できないため残しました。`,
      );
      continue;
    }
    add({
      id: `ai-cut-${start.toFixed(3)}-${end.toFixed(3)}`,
      start,
      end,
      reason: `AI：${request.reason}`,
    });
  }
  for (const silence of silenceIds)
    add({ ...silence, reason: "AI：長い無音を短縮（間は残す）" });
  for (const request of jingles) {
    const marker = ctx.markers[request.marker];
    if (music.some((m) => m.scriptJingleKey === marker.key)) continue;
    const before = ctx.cues[request.after],
      after = ctx.cues[request.after + 1];
    const left = before?.end ?? 0,
      right = after?.start ?? ctx.duration;
    const at = (left + right) / 2;
    const source = ctx.jingleSource ?? music.find((m) => m.role === "jingle");
    if (
      !source ||
      request.confidence < 0.9 ||
      right - left < 0.3 ||
      !ctx.quiet.some((q) => q.start <= at && at <= q.end) ||
      cuts.some((c) => c.start < at && at < c.end) ||
      ctx.cues.some((c) => c.start < at && at < c.end) ||
      music.length >= 20 ||
      music.some((m) => m.role === "jingle" && Math.abs(m.at - at) < 1)
    ) {
      held.push(
        `原稿${marker.line}行目のジングル：音源または安全な挿入位置を確認できないため保留しました。`,
      );
      continue;
    }
    // Reuse the buffer, not the placement: never move an existing manual clip.
    const assetId = source.assetId ?? source.id;
    music = [
      ...music.map((clip) =>
        clip.id === source.id ? { ...clip, assetId } : clip,
      ),
      {
        ...source,
        id: `ai-jingle-${request.marker}-${at.toFixed(3)}`,
        assetId,
        scriptJingleKey: marker.key,
        at,
      },
    ];
    addedJingles++;
  }
  return {
    cuts,
    music,
    held,
    summary,
    addedCuts: cuts.length - ctx.cuts.length,
    addedJingles,
  };
}
