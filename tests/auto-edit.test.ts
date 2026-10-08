import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { prepareAutoEdit, type AutoEditContext } from "../src/auto-edit";
import type { MusicClip } from "../src/types";

const source = {
  id: "j",
  name: "j.wav",
  role: "jingle",
  at: 0,
  gainDb: -8,
  buffer: { duration: 3 },
} as MusicClip;
const context = (): AutoEditContext => ({
  duration: 100,
  cues: [
    { start: 1, end: 5, text: "最初の説明です。" },
    { start: 6, end: 9, text: "やり直しましょう。" },
    { start: 11, end: 20, text: "こちらが本番の説明です。" },
  ],
  cuts: [],
  music: [],
  jingleSource: source,
  quiet: [
    { start: 5.3, end: 5.8 },
    { start: 9.3, end: 10.8 },
  ],
  silences: [
    {
      id: "s",
      start: 30,
      end: 31,
      reason: "長い間",
      kind: "silence",
      detail: "",
    },
  ],
  markers: [
    {
      key: "marker",
      line: 3,
      before: "",
      after: "",
      status: "review",
      reason: "",
    },
  ],
});
const proposal = () => ({
  cuts: [
    {
      first: 1,
      last: 1,
      kind: "retake",
      confidence: 0.99,
      reason: "収録の言い直し",
    },
  ],
  silenceIds: ["s"],
  jingles: [{ marker: 0, after: 1, confidence: 0.98 }],
  summary: "言い直しを整理しました。",
});

describe("AI editing boundary", () => {
  it("never moves an existing manually placed jingle when using its audio for a new marker", () => {
    const ctx = context();
    const manual = { ...source, at: 50 };
    ctx.music = [manual];
    ctx.jingleSource = undefined;
    const result = prepareAutoEdit(proposal(), ctx);
    expect(result.music).toHaveLength(2);
    expect(result.music[0]).toMatchObject(manual);
    expect(result.music[0].assetId).toBe(manual.id);
    expect(result.music[1].at).toBe(10);
    expect(result.music[1].assetId).toBe(manual.id);
  });
  it("returns one non-destructive plan, with quiet cut edges and a retained jingle boundary", () => {
    const ctx = context(),
      before = JSON.stringify(ctx);
    const result = prepareAutoEdit(proposal(), ctx);
    expect(result.cuts).toHaveLength(2);
    expect(result.cuts[0].start).toBe(5.8);
    expect(result.cuts[0].end).toBe(9.3);
    expect(result.music[0].at).toBe(10);
    expect(result.music[0].buffer).toBe(source.buffer);
    expect(JSON.stringify(ctx)).toBe(before);
  });
  it("keeps uncertain cuts, unsafe boundaries and overlapping retained speech for review", () => {
    const p = proposal();
    p.cuts[0].confidence = 0.5;
    expect(prepareAutoEdit(p, context()).cuts).toHaveLength(1);
    const ctx = context();
    ctx.quiet = [];
    expect(prepareAutoEdit(proposal(), ctx).held.length).toBeGreaterThan(0);
    ctx.quiet = context().quiet;
    ctx.cues.push({ start: 8, end: 12, text: "重なる発言" });
    expect(() => prepareAutoEdit(proposal(), ctx)).toThrow();
  });
  it("rejects unknown IDs, invalid indices and malformed numeric values rather than partially applying", () => {
    const p = proposal();
    p.silenceIds.push("invented");
    expect(() => prepareAutoEdit(p, context())).toThrow();
    expect(() =>
      prepareAutoEdit(
        { ...proposal(), cuts: [{ first: -1, last: 100, confidence: 1 }] },
        context(),
      ),
    ).toThrow();
    expect(() =>
      prepareAutoEdit(
        { ...proposal(), jingles: [{ marker: 0, after: NaN, confidence: 1 }] },
        context(),
      ),
    ).toThrow();
  });
  it("is idempotent and preserves manual edits and existing music", () => {
    const ctx = context();
    ctx.cuts = [{ id: "manual", start: 40, end: 42, reason: "手動" }];
    const once = prepareAutoEdit(proposal(), ctx);
    const twice = prepareAutoEdit(proposal(), {
      ...ctx,
      cuts: once.cuts,
      music: once.music,
    });
    expect(twice.cuts).toEqual(once.cuts);
    expect(twice.music).toEqual(once.music);
    expect(once.cuts).toContainEqual(ctx.cuts[0]);
  });
  it("never accepts nonfinite or out-of-range cue references", () => {
    fc.assert(
      fc.property(fc.double(), (value) => {
        const p = proposal();
        p.cuts[0].first = value;
        if (!Number.isInteger(value) || value < 0 || value > 1)
          expect(() => prepareAutoEdit(p, context())).toThrow();
      }),
      { numRuns: 200 },
    );
  });
});
