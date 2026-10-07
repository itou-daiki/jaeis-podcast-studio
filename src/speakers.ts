import type { Cue } from "./types";

export const MAX_SCRIPT_LENGTH = 100_000;
export type ScriptTurn = { speaker: string; text: string };
export type ParsedScript = {
  turns: ScriptTurn[];
  speakers: string[];
  excluded: string[];
  unassigned: string[];
};

const direction =
  /^(?:※|注[：:]|注釈|備考|編集メモ|収録メモ|テーマ|台本|原稿|♪|＜|<)|(?:ジングル|BGM|SE[：:]|拍手|笑い|コメントや|質問等|間を置|秒待|フェード)/i;
const normalize = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]/gu, "");
const isName = (s: string) =>
  s.length > 0 &&
  s.length <= 40 &&
  !direction.test(s) &&
  !/^(?:補足|注意|注|メモ|質問|コメント|見出し|ポイント|ト書き|笑|間|pause|laugh|applause|music)$/i.test(
    s,
  ) &&
  !/[。！？!?：:]/.test(s);

// A script is evidence, not a transcript. Keep excluded text visible for review.
export function parseScript(source: string): ParsedScript {
  if (source.length > MAX_SCRIPT_LENGTH)
    throw new Error("原稿は10万文字までです。");
  const result: ParsedScript = {
    turns: [],
    speakers: [],
    excluded: [],
    unassigned: [],
  };
  let speaker = "";
  let turn: ScriptTurn | undefined;
  const reset = () => {
    speaker = "";
    turn = undefined;
  };
  for (const original of source
    .replace(/^\uFEFF/, "")
    .replace(/\r/g, "")
    .split("\n")) {
    let line = original
      .replace(/\*\*|__/g, "")
      .replace(/^\s*#{1,6}\s+/, "")
      .trim();
    if (!line) continue;
    if (/^(?:※|注[：:]|備考[：:]|編集メモ|収録メモ)/.test(line)) {
      result.excluded.push(line);
      continue;
    }
    const header = line.match(
      /^(?:【([^】]+)】|\[([^\]]+)\]|([^：:\n]{1,40})[：:])\s*(.*)$/,
    );
    if (header) {
      const name = (header[1] ?? header[2] ?? header[3]).trim();
      if (!isName(name)) {
        result.excluded.push(line);
        reset();
        continue;
      }
      speaker = name;
      turn = undefined;
      if (!result.speakers.includes(name)) result.speakers.push(name);
      line = header[4].trim();
      if (!line) continue;
    }
    // Remove only explicitly marked directions inside otherwise spoken lines.
    line = line
      .replace(/[（(\[]([^）)\]]+)[）)\]]/g, (full, body: string) => {
        if (
          !direction.test(body) &&
          !/^(?:笑|拍手|沈黙|休憩|\d+秒)$/.test(body)
        )
          return full;
        result.excluded.push(full);
        return "";
      })
      .trim();
    if (!line) continue;
    if (
      /^[○〇◯□＿_\s…・.]+$/.test(line) ||
      /^(?:♪|＜|<)/.test(line) ||
      (/^[(（].*[)）]$/.test(line) && direction.test(line.slice(1, -1)))
    ) {
      result.excluded.push(line);
      if (/ジングル|コメント|質問|対話/.test(line)) reset();
      continue;
    }
    if (!speaker) {
      result.unassigned.push(line);
      continue;
    }
    if (!turn) {
      turn = { speaker, text: line };
      result.turns.push(turn);
    } else turn.text += "\n" + line;
  }
  return result;
}

export function clearSpeakerHint(cue: Cue): Cue {
  const { speakerHint: _hint, speakerReview: _review, ...rest } = cue;
  return rest;
}

export function confirmSpeaker(cue: Cue, name: string): Cue {
  const { speaker: _speaker, ...rest } = clearSpeakerHint(cue);
  return {
    ...rest,
    speakerManual: true,
    ...(name.trim() ? { speaker: name.trim().slice(0, 100) } : {}),
  };
}

const grams = (text: string) =>
  new Set(
    Array.from({ length: Math.max(0, text.length - 1) }, (_, i) =>
      text.slice(i, i + 2),
    ),
  );
function dice(a: Set<string>, b: Set<string>) {
  let common = 0;
  for (const g of a) if (b.has(g)) common++;
  return (2 * common) / (a.size + b.size || 1);
}

// Lexical resemblance is not voice identification or semantic understanding.
// Compare local passages, not the script's order: people can skip or repeat turns.
export function suggestSpeakers(cues: Cue[], script: ParsedScript): Cue[] {
  const units = script.turns.flatMap((turn) => {
    const parts = (turn.text.match(/[^。！？!?\n]+[。！？!?]?/g) ?? []).flatMap(
      (s) => {
        const chunks: string[] = [];
        for (let i = 0; i < s.length; i += 180)
          chunks.push(s.slice(i, i + 300));
        return chunks;
      },
    );
    return parts
      .flatMap((part, i) => [
        part,
        ...(parts[i + 1] && part.length + parts[i + 1].length <= 350
          ? [part + parts[i + 1]]
          : []),
      ])
      .map((excerpt) => ({
        speaker: turn.speaker,
        excerpt,
        text: normalize(excerpt),
        grams: grams(normalize(excerpt)),
      }));
  });
  const rank = (text: string) => {
    const gg = grams(text);
    const byName = new Map<
      string,
      { name: string; score: number; excerpt: string }
    >();
    for (const unit of units) {
      // A cheap overlap bound prevents scanning unrelated passages.
      let common = 0;
      for (const g of gg) if (unit.grams.has(g)) common++;
      if (common < gg.size * 0.5) continue;
      let score = unit.text.includes(text) ? 1 : dice(gg, unit.grams);
      if (score < 1 && unit.text.length > text.length) {
        for (const length of [
          Math.ceil(text.length * 0.85),
          text.length,
          Math.ceil(text.length * 1.15),
        ]) {
          const step = Math.max(1, Math.floor(text.length / 8));
          for (
            let start = 0;
            start < unit.text.length - length + step;
            start += step
          ) {
            const window = unit.text.slice(
              Math.min(start, Math.max(0, unit.text.length - length)),
              Math.min(start, Math.max(0, unit.text.length - length)) + length,
            );
            score = Math.max(score, dice(gg, grams(window)));
          }
        }
      }
      if (score > (byName.get(unit.speaker)?.score ?? 0))
        byName.set(unit.speaker, {
          name: unit.speaker,
          score,
          excerpt: unit.excerpt,
        });
    }
    return [...byName.values()].sort((a, b) => b.score - a.score);
  };
  const unique = (ranked: ReturnType<typeof rank>) =>
    ranked[0]?.score >= 0.78 &&
    ranked[0].score - (ranked[1]?.score ?? 0) >= 0.14;
  return cues.map((original) => {
    const cue = clearSpeakerHint(original);
    if (cue.speakerManual || cue.speaker || !units.length) return cue;
    const text = normalize(cue.text);
    if (text.length < 16) return { ...cue, speakerReview: "short" };
    const ranked = rank(text);
    // A single timestamp can contain two people. Never invent a dividing time.
    const parts = cue.text
      .split(/[。！？!?\n]/)
      .map(normalize)
      .filter((s) => s.length >= 16);
    if (text.length >= 48)
      parts.push(
        text.slice(0, Math.floor(text.length / 2)),
        text.slice(Math.floor(text.length / 2)),
      );
    const names = new Set(
      parts
        .map(rank)
        .filter(unique)
        .map((r) => r[0].name),
    );
    if (
      names.size > 1 ||
      (ranked[0]?.score >= 0.64 && ranked[1]?.score >= ranked[0].score - 0.14)
    )
      return { ...cue, speakerReview: "ambiguous" };
    if (!unique(ranked)) return { ...cue, speakerReview: "unmatched" };
    return {
      ...cue,
      speakerHint: { name: ranked[0].name, excerpt: ranked[0].excerpt },
    };
  });
}
