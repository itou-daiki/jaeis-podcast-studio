import type { ParsedScript } from "./speakers";
import type { Cue, MusicClip, Range } from "./types";

export function placeScriptJingle(
  music: MusicClip[],
  sourceId: string,
  key: string,
  at: number,
  duration: number,
  id: string,
): MusicClip[] {
  if (!Number.isFinite(at) || at < 0 || at > duration)
    throw new Error("音声の範囲内で挿入位置を指定してください。");
  if (music.some((m) => m.scriptJingleKey === key)) return music;
  const source = music.find((m) => m.id === sourceId && m.role === "jingle");
  if (!source) throw new Error("用途がジングルの音源を選んでください。");
  const assetId = source.assetId ?? source.id;
  const clip = { ...source, assetId, scriptJingleKey: key, at };
  if (!source.scriptJingleKey)
    return music.map((m) => (m.id === sourceId ? clip : m));
  if (music.length >= 20) throw new Error("音楽は20本までです。");
  return [
    ...music.map((m) => (m.id === sourceId ? { ...m, assetId } : m)),
    { ...clip, id },
  ];
}

export type JingleSuggestion = {
  key: string;
  line: number;
  before: string;
  after: string;
  status: "matched" | "review";
  reason: string;
  at?: number;
  context?: Range;
};

const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
const grams = (s: string) =>
  new Set(
    Array.from({ length: Math.max(0, s.length - 1) }, (_, i) =>
      s.slice(i, i + 2),
    ),
  );
const edge = (s: string, before: boolean, size: number) =>
  before ? s.slice(-size) : s.slice(0, size);

function anchor(text: string, before: boolean) {
  const sentences = text.match(/[^。！？!?\n]+[。！？!?\n]*/g) ?? [];
  if (before) sentences.reverse();
  let selected = "";
  for (const sentence of sentences) {
    selected = before ? sentence + selected : selected + sentence;
    if (normalize(selected).length >= 24) break;
  }
  return edge(normalize(selected), before, 100);
}

function similarity(anchor: string, text: string, before: boolean) {
  const a = grams(anchor);
  let best = 0;
  for (const factor of [0.8, 1, 1.2]) {
    const b = grams(edge(text, before, Math.ceil(anchor.length * factor)));
    let shared = 0;
    for (const g of a) if (b.has(g)) shared++;
    best = Math.max(best, (2 * shared) / (a.size + b.size || 1));
  }
  return best;
}

// Script directions are anchors, never a command to alter recorded dialogue.
// Only transcript boundaries supply times; text resemblance cannot time words
// inside a cue or decide which of multiple takes should be kept.
export function suggestJingles(
  script: ParsedScript,
  cues: Cue[],
  duration: number,
): JingleSuggestion[] {
  if (script.sequence.filter((s) => s.kind === "jingle").length > 50)
    throw new Error(
      "ジングル指定が多いため、今回使う原稿の範囲に絞ってください（50か所まで）。",
    );
  const speech = cues.map((c) => normalize(c.text));
  return script.sequence.flatMap((item, index) => {
    if (item.kind !== "jingle") return [];
    let before = "",
      after = "";
    for (let i = index - 1; i >= 0; i--) {
      const part = script.sequence[i];
      if (part.kind === "jingle") break;
      before = part.text + before;
      if (before.length >= 160) break;
    }
    for (let i = index + 1; i < script.sequence.length; i++) {
      const part = script.sequence[i];
      if (part.kind === "jingle") break;
      after += part.text;
      if (after.length >= 160) break;
    }
    before = before.slice(-160);
    after = after.slice(0, 160);
    const result: JingleSuggestion = {
      key: JSON.stringify([index, before, after]),
      line: item.line,
      before,
      after,
      status: "review",
      reason:
        "前後の発言を特定できません。音声を聞いて位置を指定してください。",
    };
    const a = anchor(before, true),
      b = anchor(after, false);
    if (a.length < 12 || b.length < 12) return [result];
    const ranked: { at: number; score: number; context: Range }[] = [];
    for (let i = 0; i < cues.length - 1; i++) {
      const gap = cues[i + 1].start - cues[i].end;
      if (gap < 0 || gap > 30 || cues[i + 1].start > duration) continue;
      let left = "",
        right = "",
        l = 0,
        r = 0;
      for (let n = 0; n < 3; n++) {
        if (i - n >= 0) {
          left = speech[i - n] + left;
          l = Math.max(l, similarity(a, left, true));
        }
        if (i + n + 1 < cues.length) {
          right += speech[i + n + 1];
          r = Math.max(r, similarity(b, right, false));
        }
      }
      if (Math.min(l, r) >= 0.72 && (l + r) / 2 >= 0.8)
        ranked.push({
          at: (cues[i].end + cues[i + 1].start) / 2,
          score: (l + r) / 2,
          context: { start: cues[i].start, end: cues[i + 1].end },
        });
    }
    ranked.sort((x, y) => y.score - x.score);
    if (!ranked.length) return [result];
    if (ranked[1] && ranked[0].score - ranked[1].score < 0.1)
      return [
        {
          ...result,
          reason:
            "同じような発言が複数あります。リテイクや繰り返しを確認してください。",
        },
      ];
    return [
      {
        ...result,
        status: "matched" as const,
        at: ranked[0].at,
        context: ranked[0].context,
        reason:
          "原稿の前後の発言に対応する字幕の境目が見つかりました。前後を聞いて確認してください。",
      },
    ];
  });
}
