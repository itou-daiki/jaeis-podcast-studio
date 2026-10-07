import { expect, test } from "vitest";
import { silenceCandidates, encodeWav } from "../src/media";
import {
  buildPlacements,
  buildSegments,
  outputToSource,
  sourceToOutput,
} from "../src/editing";
import type { MusicClip, Track } from "../src/types";

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
  ).toMatchObject([{ start: 0.25, end: 4.75 }]);
  expect(silenceCandidates([{ ...quiet, muted: true }], 5)).toEqual([]);
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
