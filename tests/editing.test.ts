import { expect, test } from "vitest";
import {
  buildSegments,
  buildPlacements,
  normalizeCuts,
  outputToSource,
  applyCutRange,
} from "../src/editing";
import fc from "fast-check";
import { readProject, saveProject } from "../src/project";

test("playback and export placements use adjusted voices without moving cuts", () => {
  const buffer = { duration: 10 } as AudioBuffer;
  const processed = { duration: 10 } as AudioBuffer;
  const track = { buffer, processed, offset: 2, muted: false, gainDb: -3 };
  const segments = buildSegments(12, [{ start: 4, end: 6 }]);
  const original = buildPlacements(
    [{ ...track, processed: undefined }],
    segments,
    [],
  );
  const adjusted = buildPlacements([track], segments, []);
  expect(adjusted.placements.every((p) => p.buffer === processed)).toBe(true);
  expect(original.placements.every((p) => p.buffer === buffer)).toBe(true);
  expect(adjusted.mapping).toEqual(original.mapping);
  expect(adjusted.duration).toBe(original.duration);
  expect(adjusted.placements.map(({ buffer: _, ...p }) => p)).toEqual(
    original.placements.map(({ buffer: _, ...p }) => p),
  );
});

test("random fine-tuning is idempotent and survives project save without changing the original", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: 0, max: 90000 }),
      fc.integer({ min: 30, max: 9999 }),
      (startMs, lengthMs) => {
        const cuts = [
          { id: "silence-1", start: 1, end: 2, reason: "静かな間" },
        ];
        const change = {
          ...cuts[0],
          start: startMs / 1000,
          end: (startMs + lengthMs) / 1000,
        };
        const updated = applyCutRange(cuts, change, 100);
        expect(applyCutRange(updated, change, 100)).toEqual(updated);
        expect(updated).toEqual([change]);
        expect(cuts[0]).toMatchObject({ start: 1, end: 2 });
        const data = {
          version: 1 as const,
          title: "微調整",
          cuts: updated,
          cues: [],
          tracks: [],
          music: [],
        };
        expect(readProject(saveProject(data)).cuts).toEqual(updated);
      },
    ),
    { numRuns: 150 },
  );
});

test("overlapping cuts remove time once and preserve the rest in source order", () => {
  expect(
    buildSegments(20, [
      { start: 3, end: 6 },
      { start: 5, end: 9 },
    ]),
  ).toEqual([
    { start: 0, end: 3, outputStart: 0 },
    { start: 9, end: 20, outputStart: 3 },
  ]);
});

test("fine-tuning replaces one cut in place, preserves undo input and synchronizes the new plan", () => {
  const cuts = [
    { id: "pause", start: 2, end: 5, reason: "静かな間" },
    { id: "other", start: 8, end: 9, reason: "別のカット" },
  ];
  const updated = applyCutRange(
    cuts,
    { ...cuts[0], start: 2.05, end: 4.95 },
    10,
  );
  expect(updated).toEqual([{ ...cuts[0], start: 2.05, end: 4.95 }, cuts[1]]);
  expect(cuts[0]).toMatchObject({ start: 2, end: 5 });
  const tracks = [0, 1].map(() => ({
    buffer: { duration: 10 } as AudioBuffer,
    offset: 0,
    muted: false,
    gainDb: 0,
  }));
  const plan = buildPlacements(tracks, buildSegments(10, updated), []);
  expect(plan.placements.filter((p) => p.offset === 4.95)).toHaveLength(2);
  expect(plan.duration).toBeCloseTo(6.1);
  expect(() =>
    applyCutRange(cuts, { ...cuts[0], start: 5, end: 4 }, 10),
  ).toThrow();
  expect(() => applyCutRange(cuts, { ...cuts[0], start: -1 }, 10)).toThrow();
});

test("all speakers receive the same edit and respect their recording offset", () => {
  const buffer = { duration: 10 } as AudioBuffer;
  const plan = buildPlacements(
    [
      { buffer, offset: 0, muted: false, gainDb: 0 },
      { buffer, offset: 2, muted: false, gainDb: -6 },
    ],
    buildSegments(12, [{ start: 4, end: 6 }]),
    [],
  );
  expect(plan.placements.map((p) => [p.when, p.offset, p.duration])).toEqual([
    [0, 0, 4],
    [4, 6, 4],
    [2, 0, 2],
    [4, 4, 6],
  ]);
  expect(plan.duration).toBe(10);
  expect(outputToSource(4, plan.mapping)).toBe(6);
});

test("random overlapping edits partition the source without losing or duplicating time", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.tuple(
          fc.integer({ min: -20, max: 120 }),
          fc.integer({ min: -20, max: 120 }),
        ),
      ),
      (pairs) => {
        const cuts = pairs.map(([a, b]) => ({
          start: Math.min(a, b),
          end: Math.max(a, b),
        }));
        const normalized = normalizeCuts(cuts, 100);
        const kept = buildSegments(100, cuts);
        expect(normalizeCuts(normalized, 100)).toEqual(normalized);
        expect(
          [...normalized, ...kept].reduce((sum, r) => sum + r.end - r.start, 0),
        ).toBe(100);
        for (let sample = 0.5; sample < 100; sample++) {
          expect(
            [...normalized, ...kept].filter(
              (r) => sample >= r.start && sample < r.end,
            ),
          ).toHaveLength(1);
        }
      },
    ),
    { numRuns: 200 },
  );
});
