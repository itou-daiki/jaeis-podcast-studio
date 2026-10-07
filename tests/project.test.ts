import { expect, test } from "vitest";
import { readProject, saveProject } from "../src/project";

test("project export roundtrips edits but never serializes audio samples", () => {
  const data = {
    version: 1 as const,
    title: "第1回",
    cuts: [{ id: "1", start: 1, end: 3, reason: "手動" }],
    cues: [{ start: 0, end: 1, text: "こんにちは" }],
    tracks: [
      {
        name: "voice.wav",
        size: 500,
        lastModified: 123,
        gainDb: -3,
        offset: 2,
        muted: false,
      },
    ],
    music: [],
  };
  expect(readProject(saveProject(data))).toEqual(data);
  expect(() => readProject('{"version":999}')).toThrow();
  expect(() =>
    readProject(
      JSON.stringify({ ...data, cuts: [{ start: 1, end: Infinity }] }),
    ),
  ).toThrow();
});
