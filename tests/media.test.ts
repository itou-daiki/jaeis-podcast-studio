import { expect, test } from "vitest";
import { silenceCandidates, encodeWav, schedule } from "../src/media";
import {
  buildPlacements,
  buildSegments,
  outputToSource,
  sourceToOutput,
} from "../src/editing";
import type { MusicClip, Track } from "../src/types";
import fc from "fast-check";

test("BGM loops under the conversation, spans cuts smoothly, and leaves OP/ED/jingles alone", () => {
  const buffer = { duration: 30 } as AudioBuffer;
  const tracks = [0, 0.25].map((offset) => ({
    buffer,
    offset,
    gainDb: 0,
    muted: false,
  }));
  const clip = {
    id: "m",
    name: "music",
    buffer: { duration: 2 } as AudioBuffer,
    gainDb: -12,
    at: 15,
  };
  const music: MusicClip[] = [
    { ...clip, role: "opening" },
    { ...clip, role: "ending" },
    { ...clip, role: "jingle" },
  ];
  const bgm: MusicClip = {
    ...clip,
    buffer: { duration: 4 } as AudioBuffer,
    role: "bgm",
    gainDb: -26,
  };
  const segments = buildSegments(30, [{ start: 5, end: 8 }]);
  const before = buildPlacements(tracks, segments, music);
  const after = buildPlacements(tracks, segments, [...music, bgm]);
  expect(after.duration).toBe(33);
  expect(after.mapping).toEqual(before.mapping);
  expect(after.placements.filter((p) => p.buffer !== bgm.buffer)).toEqual(
    before.placements,
  );
  expect(
    after.placements
      .filter((p) => p.buffer === bgm.buffer)
      .map(({ when, duration, loop }) => ({ when, duration, loop })),
  ).toEqual([
    { when: 2, duration: 12, loop: true },
    { when: 16, duration: 15, loop: true },
  ]);
  expect(buildPlacements(tracks, [], [bgm]).placements).toEqual([]);
});

test("previewing midway through a long BGM repeats the source instead of starting beyond its end", () => {
  const starts: number[][] = [];
  const source = {
    loop: false,
    connect() {},
    start(...args: number[]) {
      starts.push(args);
    },
  };
  const ctx = {
    createBufferSource: () => source,
    createGain: () => ({
      connect() {},
      gain: { setValueAtTime() {}, linearRampToValueAtTime() {} },
    }),
    destination: {},
  } as unknown as BaseAudioContext;
  schedule(
    ctx,
    [
      {
        buffer: { duration: 4 } as AudioBuffer,
        when: 2,
        offset: 0,
        duration: 28,
        gain: 0.05,
        fade: 0.6,
        loop: true,
      },
    ],
    15,
    25,
    100,
  );
  expect(source.loop).toBe(true);
  expect(starts).toEqual([[100, 1, 10]]);
});

test("adding BGM preserves every voice sample and output timestamp for arbitrary cuts", () => {
  fc.assert(
    fc.property(
      fc.array(
        fc.tuple(
          fc.integer({ min: 0, max: 60000 }),
          fc.integer({ min: 0, max: 60000 }),
        ),
        { maxLength: 25 },
      ),
      fc.integer({ min: 0, max: 60000 }),
      (ranges, jingleMs) => {
        const tracks = [0, 0.17].map((offset) => ({
          buffer: { duration: 60 } as AudioBuffer,
          offset,
          gainDb: 0,
          muted: false,
        }));
        const music: MusicClip[] = [
          {
            id: "j",
            name: "j",
            role: "jingle",
            at: jingleMs / 1000,
            gainDb: -12,
            buffer: { duration: 3 } as AudioBuffer,
          },
        ];
        const bgm: MusicClip = {
          ...music[0],
          role: "bgm",
          buffer: { duration: 16 } as AudioBuffer,
        };
        const segments = buildSegments(
          60,
          ranges.map(([a, b]) => ({
            start: Math.min(a, b) / 1000,
            end: Math.max(a, b) / 1000,
          })),
        );
        const base = buildPlacements(tracks, segments, music);
        const mixed = buildPlacements(tracks, segments, [...music, bgm]);
        expect(mixed.duration).toBe(base.duration);
        expect(mixed.mapping).toEqual(base.mapping);
        expect(mixed.placements.filter((p) => p.buffer !== bgm.buffer)).toEqual(
          base.placements,
        );
        const beds = mixed.placements.filter((p) => p.buffer === bgm.buffer);
        expect(beds.reduce((n, p) => n + p.duration, 0)).toBeCloseTo(
          segments.reduce((n, s) => n + s.end - s.start, 0),
          8,
        );
        for (const p of beds) {
          expect(p.duration).toBeGreaterThan(0);
          expect(p.when + p.duration).toBeLessThanOrEqual(
            mixed.duration + 1e-8,
          );
          for (const j of base.placements.filter(
            (p) => p.buffer === music[0].buffer,
          )) {
            expect(
              p.when + p.duration <= j.when + 1e-8 ||
                p.when >= j.when + j.duration - 1e-8,
            ).toBe(true);
          }
        }
      },
    ),
    { numRuns: 150 },
  );
});

test("a pause is only proposed if every unmuted speaker is quiet", () => {
  const quiet = {
    rms: new Float32Array(100),
    offset: 0,
    gainDb: 0,
    muted: false,
  } as Track;
  const speaking = { ...quiet, rms: new Float32Array(100).fill(0.1) };
  expect(silenceCandidates([quiet, speaking], 5)).toEqual([]);
  expect(
    silenceCandidates([quiet, { ...speaking, muted: true }], 5),
  ).toMatchObject([{ start: 0.4, end: 4.6 }]);
  expect(silenceCandidates([{ ...quiet, muted: true }], 5)).toEqual([]);
});

test("silence shortening keeps an adjustable pause and leaves short breaths alone", () => {
  const rms = new Float32Array(160).fill(0.1);
  rms.fill(0, 20, 100); // four-second pause, from 1s to 5s
  rms.fill(0, 120, 132); // a brief breath, not a cut
  const track = {
    rms,
    peaks: rms.slice(),
    muted: false,
    gainDb: 0,
    offset: 0,
  } as Track;
  expect(silenceCandidates([track], 8)).toMatchObject([
    { start: 1.4, end: 4.6 },
  ]);
  expect(silenceCandidates([track], 8, -45, 2, 1.2)).toMatchObject([
    { start: 1.6, end: 4.4 },
  ]);
});

test("quiet utterances and short transients are protected before mixer gain", () => {
  const rms = new Float32Array(100).fill(0.01);
  const track = {
    rms,
    peaks: rms.slice(),
    offset: 0,
    gainDb: -24,
    muted: false,
  } as Track;
  expect(silenceCandidates([track], 5, -45)).toEqual([]);
  const lowRms = new Float32Array(100).fill(0.001);
  const peaks = new Float32Array(100).fill(0.001);
  peaks[50] = 0.1; // a short sound hidden by the 50ms average
  const result = silenceCandidates([{ ...track, rms: lowRms, peaks }], 5, -45);
  expect(result).toHaveLength(2);
  expect(result.every((c) => c.end < 2.5 || c.start > 2.55)).toBe(true);
});

test("automatic detection adapts conservatively to a quiet background", () => {
  const rms = new Float32Array(120).fill(0.0008); // about -62dBFS background
  rms.fill(0.003, 50, 70); // about -50dBFS quiet voice
  const track = {
    rms,
    peaks: rms.slice(),
    offset: 0,
    gainDb: 0,
    muted: false,
  } as Track;
  const result = silenceCandidates([track], 6, null);
  expect(result).toHaveLength(2);
  expect(result.every((c) => c.end < 2.5 || c.start > 3.5)).toBe(true);
  // No false claim of silence for steady speech or noisy room tone.
  expect(
    silenceCandidates(
      [{ ...track, rms: new Float32Array(120).fill(0.02) }],
      6,
      null,
    ),
  ).toEqual([]);
});

test("cuts never cross an audible source block even with sub-frame track offsets", () => {
  fc.assert(
    fc.property(
      fc.integer({ min: -49, max: 49 }),
      fc.integer({ min: 30, max: 100 }),
      (offsetMs, index) => {
        const rms = new Float32Array(160);
        rms[index] = 0.03;
        const offset = offsetMs / 1000;
        const track = {
          rms,
          peaks: rms.slice(),
          offset,
          gainDb: -24,
          muted: false,
        } as Track;
        const candidates = silenceCandidates([track], 8, -45, 0.5, 0.3);
        const voice = {
          start: offset + index * 0.05,
          end: offset + (index + 1) * 0.05,
        };
        expect(candidates.length).toBeGreaterThan(0);
        for (const c of candidates) {
          expect(c.start).toBeGreaterThanOrEqual(0);
          expect(c.end).toBeLessThanOrEqual(8);
          expect(c.end).toBeGreaterThan(c.start);
          expect(c.end <= voice.start || c.start >= voice.end).toBe(true);
        }
        expect(
          silenceCandidates([{ ...track, gainDb: 12 }], 8, -45, 0.5, 0.3),
        ).toEqual(candidates);
      },
    ),
    { numRuns: 150 },
  );
});

test("jingle insertion shifts all voices together without consuming source audio", () => {
  const buffer = { duration: 10 } as AudioBuffer;
  const music = [
    {
      id: "j",
      buffer: { duration: 2 } as AudioBuffer,
      role: "jingle",
      at: 5,
      gainDb: 0,
      name: "j",
    },
  ] as MusicClip[];
  const plan = buildPlacements(
    [{ buffer, offset: 0, gainDb: 0, muted: false }],
    buildSegments(10, []),
    music,
  );
  expect(plan.duration).toBe(12);
  expect(plan.mapping).toEqual([
    { start: 0, end: 5, outputStart: 0 },
    { start: 5, end: 10, outputStart: 7 },
  ]);
  expect(sourceToOutput(5, plan.mapping)).toBe(7);
  expect(outputToSource(6, plan.mapping)).toBe(5);
  expect(plan.placements.map((p) => [p.when, p.offset, p.duration])).toEqual([
    [5, 0, 2],
    [0, 0, 5],
    [7, 5, 5],
  ]);
});

test("PCM WAV has a valid header and clips samples instead of integer wraparound", async () => {
  const buffer = {
    numberOfChannels: 1,
    length: 5,
    sampleRate: 44100,
    getChannelData: () => new Float32Array([-2, -0.5, 0, 0.5, 2]),
  } as unknown as AudioBuffer;
  const bytes = await encodeWav(buffer),
    view = new DataView(bytes.buffer);
  expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe("RIFF");
  expect(view.getUint32(40, true)).toBe(10);
  expect([44, 46, 48, 50, 52].map((n) => view.getInt16(n, true))).toEqual([
    -32768, -16384, 0, 16384, 32767,
  ]);
});
