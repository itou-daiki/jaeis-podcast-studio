import { expect, test } from "vitest";
import {
  buildSegments,
  buildPlacements,
  normalizeCuts,
  outputToSource,
} from "../src/editing";
import fc from "fast-check";

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
