import { describe, expect, it } from "vitest";
import { stepProgress } from "../src/Workflow";

const base = {
  trackCount: 1,
  cutCount: 0,
  remaining: 0,
  music: [],
  duration: 125,
  exported: false,
};

describe("stepProgress", () => {
  it("shows nothing done before audio is loaded", () => {
    const p = stepProgress({ ...base, trackCount: 0 });
    expect(p.source).toEqual({ text: "未読み込み", done: false });
    expect(p.export.text).toBe("");
  });

  it("marks cutting done only when no candidate is left undecided", () => {
    expect(stepProgress({ ...base, cutCount: 2, remaining: 3 }).edit).toEqual({
      text: "2件カット・候補 残り3件",
      done: false,
    });
    expect(stepProgress({ ...base, cutCount: 2 }).edit).toEqual({
      text: "2件カット",
      done: true,
    });
    expect(stepProgress(base).edit.done).toBe(false);
    expect(stepProgress({ ...base, reviewed: true }).edit).toEqual({
      text: "候補を確認済み",
      done: true,
    });
  });

  it("summarizes added music by role", () => {
    const p = stepProgress({
      ...base,
      music: [
        { role: "opening" },
        { role: "ending" },
        { role: "jingle" },
        { role: "jingle" },
      ],
    });
    expect(p.sound).toEqual({ text: "OP・ED・ジングル2 追加済み", done: true });
    expect(stepProgress(base).sound).toEqual({ text: "音楽なし", done: false });
  });

  it("reports export state with the output length", () => {
    expect(stepProgress(base).export).toEqual({
      text: "完成 02:05・未書き出し",
      done: false,
    });
    expect(stepProgress({ ...base, exported: true }).export.done).toBe(true);
  });
});
