import type { Candidate, Cue, Segment } from "./types";

function seconds(value: string): number {
  return value
    .replace(",", ".")
    .split(":")
    .reduce((total, v) => total * 60 + Number(v), 0);
}
export function validateCues(input: unknown): Cue[] {
  if (!Array.isArray(input) || input.length > 50000)
    throw new Error("字幕の形式または件数を確認してください。");
  return input
    .map((c: Record<string, unknown>): Cue => {
      if (
        !c ||
        !Number.isFinite(c.start) ||
        !Number.isFinite(c.end) ||
        Number(c.start) < 0 ||
        Number(c.end) <= Number(c.start) ||
        typeof c.text !== "string"
      )
        throw new Error("字幕の時刻・本文が正しくありません。");
      const hint = c.speakerHint as Record<string, unknown> | undefined;
      if (
        (c.speakerManual !== undefined &&
          typeof c.speakerManual !== "boolean") ||
        (hint !== undefined &&
          (!hint ||
            typeof hint.name !== "string" ||
            typeof hint.excerpt !== "string")) ||
        (c.speakerReview !== undefined &&
          (typeof c.speakerReview !== "string" ||
            !["short", "unmatched", "ambiguous"].includes(c.speakerReview)))
      )
        throw new Error("話者の確認情報が正しくありません。");
      return {
        start: Number(c.start),
        end: Number(c.end),
        text: c.text.slice(0, 10000),
        ...(typeof c.speaker === "string"
          ? { speaker: c.speaker.slice(0, 100) }
          : {}),
        ...(typeof c.speakerManual === "boolean"
          ? { speakerManual: c.speakerManual }
          : {}),
        ...(hint
          ? {
              speakerHint: {
                name: (hint.name as string).slice(0, 100),
                excerpt: (hint.excerpt as string).slice(0, 350),
              },
            }
          : {}),
        ...(c.speakerReview
          ? { speakerReview: c.speakerReview as Cue["speakerReview"] }
          : {}),
      };
    })
    .sort((a, b) => a.start - b.start);
}
export function parseTranscript(source: string): Cue[] {
  const text = source.replace(/^\uFEFF/, "").trim();
  if (text.startsWith("{") || text.startsWith("[")) {
    const data = JSON.parse(text);
    if (Array.isArray(data?.chunks)) {
      if (data.chunks.length > 50000)
        throw new Error("字幕の件数が多すぎます。");
      return validateCues(
        data.chunks.map((c: { timestamp?: unknown[]; text?: unknown }) => {
          if (
            !Array.isArray(c?.timestamp) ||
            c.timestamp.length !== 2 ||
            !c.timestamp.every(
              (t) => typeof t === "number" && Number.isFinite(t),
            )
          )
            throw new Error(
              "Whisper JSONの開始・終了時刻が不足しています。時刻付きのsegmentsまたはSRTで出力してください。",
            );
          return { start: c.timestamp[0], end: c.timestamp[1], text: c.text };
        }),
      );
    }
    return validateCues(Array.isArray(data) ? data : data?.segments);
  }
  const cues: Cue[] = [];
  const stamp = /(\d{1,2}:)?\d{2}:\d{2}[.,]\d{1,3}/g;
  for (const block of text.replace(/\r/g, "").split(/\n\s*\n/)) {
    const lines = block.split("\n");
    const index = lines.findIndex((l) => l.includes("-->"));
    if (index < 0) continue;
    const times = lines[index].match(stamp);
    if (!times || times.length < 2) continue;
    const original = lines
      .slice(index + 1)
      .join(" ")
      .trim();
    const voice = original.match(/^<v\s+([^>]+)>(.*?)(?:<\/v>)?$/);
    const clean = original.replace(/<[^>]+>/g, "");
    const named = clean.match(/^([^:：]{1,40})[:：]\s*(.*)$/);
    const speaker = voice?.[1] ?? named?.[1];
    cues.push({
      start: seconds(times[0]),
      end: seconds(times[1]),
      text: voice ? voice[2].replace(/<[^>]+>/g, "") : named ? named[2] : clean,
      ...(speaker ? { speaker } : {}),
    });
  }
  if (!cues.length)
    throw new Error("時刻付きのVTT・SRT、またはWhisper JSONを選んでください。");
  return validateCues(cues);
}

export function toSrt(cues: Cue[]): string {
  const stamp = (time: number) => {
    const ms = Math.round(time * 1000);
    return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`;
  };
  return cues
    .map(
      (c, i) =>
        `${i + 1}\n${stamp(c.start)} --> ${stamp(c.end)}\n${c.speaker ? c.speaker + ": " : ""}${c.text}\n`,
    )
    .join("\n");
}

export function editedCues(cues: Cue[], mapping: Segment[]): Cue[] {
  // A cue crossing a cut is ambiguous: don't duplicate the complete sentence.
  return cues.flatMap((c) => {
    const kept = mapping.filter((s) => c.start >= s.start && c.end <= s.end);
    return kept.map((s) => ({
      ...c,
      start: s.outputStart + c.start - s.start,
      end: s.outputStart + c.end - s.start,
    }));
  });
}

const normalized = (text: string) =>
  text.normalize("NFKC").replace(/[\s\p{P}\p{S}]/gu, "");
function similarity(a: string, b: string): number {
  const grams = (s: string) =>
    new Set(
      Array.from({ length: Math.max(0, s.length - 1) }, (_, i) =>
        s.slice(i, i + 2),
      ),
    );
  const aa = grams(a),
    bb = grams(b);
  return (
    (2 * [...aa].filter((s) => bb.has(s)).length) / (aa.size + bb.size || 1)
  );
}
export function detectRetakes(cues: Cue[]): Candidate[] {
  const result: Candidate[] = [];
  cues.forEach((cue, i) => {
    const text = normalized(cue.text);
    if (
      /(?:やり直します|やり直しましょう|撮り直します|取り直します|もう一回いきます|もう一度お願いします)/.test(
        text,
      ) &&
      !/[「『"]/.test(cue.text) &&
      !/(という|と言|生徒|授業で)/.test(cue.text)
    ) {
      result.push({
        ...cue,
        id: `retake-${cue.start}-${cue.end}`,
        kind: "retake",
        reason: "やり直しの発言",
        detail:
          "この発言のみを候補にしています。直前の失敗テイクを含める場合は、波形で範囲を広げてください。",
      });
    }
    const next = cues[i + 1];
    if (
      next &&
      text.length >= 18 &&
      next.start - cue.end >= 0 &&
      next.start - cue.end < 20 &&
      (!cue.speaker || !next.speaker || cue.speaker === next.speaker) &&
      similarity(text, normalized(next.text)) > 0.84
    ) {
      result.push({
        ...cue,
        id: `repeat-${cue.start}-${cue.end}`,
        kind: "repeat",
        reason: "直後に似た発言",
        detail:
          "強調や相づちの可能性もあります。後の発言と聞き比べてください。話者不明の場合は特に確認が必要です。",
      });
    }
  });
  return result;
}
