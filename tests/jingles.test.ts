import { expect, test } from "vitest";
import fc from "fast-check";
import { placeScriptJingle, suggestJingles } from "../src/jingles";
import { parseScript } from "../src/speakers";
import type { MusicClip } from "../src/types";
import { buildPlacements, buildSegments } from "../src/editing";

test("shared jingle placements preserve both speakers' remaining audio and synchronization", () => {
  const source: MusicClip = {
    id: "jingle",
    name: "cue.wav",
    role: "jingle",
    at: 0,
    gainDb: -12,
    buffer: { duration: 3 } as AudioBuffer,
  };
  const first = placeScriptJingle([source], source.id, "mark-1", 10, 60, "one");
  const music = placeScriptJingle(first, source.id, "mark-2", 40, 60, "two");
  const tracks = [0, 1].map(() => ({
    buffer: { duration: 60 } as AudioBuffer,
    offset: 0,
    muted: false,
    gainDb: 0,
  }));
  const plan = buildPlacements(
    tracks,
    buildSegments(60, [{ start: 20, end: 25 }]),
    music,
  );
  expect(plan.duration).toBe(61);
  expect(
    plan.placements
      .filter((p) => p.buffer === source.buffer)
      .map((p) => p.when),
  ).toEqual([10, 38]);
  const voices = tracks.map((t) =>
    plan.placements.filter((p) => p.buffer === t.buffer),
  );
  expect(
    voices[0].map(({ when, offset, duration }) => ({ when, offset, duration })),
  ).toEqual(
    voices[1].map(({ when, offset, duration }) => ({ when, offset, duration })),
  );
  expect(voices[0].reduce((n, p) => n + p.duration, 0)).toBe(55);
});

test("confirmed markers reuse the chosen jingle, never double insert, and preserve manual adjustments", () => {
  const music: MusicClip[] = [
    {
      id: "source",
      name: "jingle.wav",
      role: "jingle",
      at: 0,
      gainDb: -12,
      buffer: { duration: 3 } as AudioBuffer,
    },
  ];
  const once = placeScriptJingle(
    music,
    "source",
    "first-mark",
    10,
    60,
    "new-1",
  );
  expect(once).toHaveLength(1);
  expect(once[0]).toMatchObject({
    at: 10,
    assetId: "source",
    scriptJingleKey: "first-mark",
  });
  const twice = placeScriptJingle(
    once,
    "source",
    "second-mark",
    20,
    60,
    "new-2",
  );
  expect(twice).toHaveLength(2);
  expect(twice[1].buffer).toBe(music[0].buffer);
  expect(twice[1]).toMatchObject({
    at: 20,
    assetId: "source",
    scriptJingleKey: "second-mark",
  });
  const manual = twice.map((m) => ({ ...m, at: m.at + 1 }));
  expect(
    placeScriptJingle(manual, "source", "first-mark", 10, 60, "new-3"),
  ).toEqual(manual);
  expect(music[0].at).toBe(0);
  expect(() =>
    placeScriptJingle(once, "source", "other", NaN, 60, "invalid"),
  ).toThrow();
});

const before = "情報科の先生方に気軽に聞いていただけるお話になれば幸いです。";
const after = "それでは今回のスピーカーに簡単な自己紹介をしていただきます。";
const script = parseScript(`【司会】${before}\n♪ジングル♪\n${after}`);

test("script jingle maps between nearby transcript cues despite modest wording differences", () => {
  const cues = [
    {
      start: 4,
      end: 12,
      text: "全国の情報科の先生方に、気軽に聞いていただけるようなお話になれば幸いです。",
    },
    {
      start: 14,
      end: 21,
      text: "では今回のスピーカーに、簡単な自己紹介をしていただきます。",
    },
  ];
  const result = suggestJingles(script, cues, 25);
  expect(result).toHaveLength(1);
  expect(result[0]).toMatchObject({ status: "matched", at: 13, line: 2 });
  expect(result[0].before).toBe(before);
  expect(result[0].after).toBe(after);
});

test("a matching boundary is not hidden by later unscripted introductions", () => {
  const longScript = parseScript(
    `【司会】${before}\n♪ジングル♪\n${after}\n【田中先生】東京で教員をしている田中です。今日は情報デザインの授業について話します。`,
  );
  const result = suggestJingles(
    longScript,
    [
      { start: 0, end: 8, text: before },
      { start: 10, end: 18, text: after },
      {
        start: 20,
        end: 28,
        text: "よろしくお願いします。ちょっと緊張していますが、いろいろ伺えれば嬉しいです。",
      },
    ],
    30,
  );
  expect(result[0]).toMatchObject({ status: "matched", at: 9 });
});

test("repeated takes, same-cue boundaries, off-script speech, and overlapping speech require review", () => {
  const a = { start: 0, end: 5, text: before },
    b = { start: 6, end: 10, text: after };
  for (const cues of [
    [a, b, { ...a, start: 20, end: 25 }, { ...b, start: 26, end: 30 }],
    [{ start: 0, end: 20, text: before + after }],
    [
      a,
      { start: 6, end: 8, text: "ここは原稿にはない大事な対話です。" },
      { ...b, start: 9, end: 14 },
    ],
    [a, { ...b, start: 4 }],
    [{ ...a, text: "昨日は雨だったので図書館に行きました。" }, b],
  ]) {
    const result = suggestJingles(script, cues, 40)[0];
    expect(result.status).toBe("review");
    expect(result.at).toBeUndefined();
  }
});

test("jingle suggestions shift with recording timestamps and leave script and transcript untouched", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 2000 }),
      fc.integer({ min: 0, max: 20 }),
      (offset, gap) => {
        const cues = [
          { start: offset, end: offset + 5, text: before },
          { start: offset + 5 + gap, end: offset + 10 + gap, text: after },
        ];
        const snapshot = JSON.stringify({ script, cues });
        const [r] = suggestJingles(script, cues, offset + 20 + gap);
        expect(r.at).toBeGreaterThanOrEqual(offset + 5);
        expect(r.at).toBeLessThanOrEqual(offset + 5 + gap);
        expect(JSON.stringify({ script, cues })).toBe(snapshot);
        const shifted = cues.map((c) => ({
          ...c,
          start: c.start + 7,
          end: c.end + 7,
        }));
        expect(suggestJingles(script, shifted, offset + 27 + gap)[0].at).toBe(
          r.at! + 7,
        );
      },
    ),
    { numRuns: 120 },
  );
});
