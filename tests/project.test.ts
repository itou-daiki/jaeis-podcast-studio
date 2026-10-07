import { expect, test } from "vitest";
import { missingSources, readProject, saveProject } from "../src/project";

test("resume identifies missing sources, including repeated uses of the same jingle", () => {
  const project = readProject(
    JSON.stringify({
      version: 1,
      title: "再開",
      cuts: [],
      cues: [],
      tracks: [
        {
          name: "voice.wav",
          size: 500,
          lastModified: 123,
          gainDb: 0,
          offset: 0,
          muted: false,
        },
      ],
      music: [0, 1].map(() => ({
        name: "jingle.wav",
        duration: 2,
        role: "jingle",
        at: 5,
        gainDb: -12,
      })),
    }),
  );
  expect(missingSources(project, [], [])).toEqual({
    voices: ["voice.wav"],
    music: ["jingle.wav", "jingle.wav"],
  });
  expect(
    missingSources(
      project,
      [{ name: "voice.wav", size: 500, lastModified: 124 }],
      [{ name: "jingle.wav", duration: 2 }],
    ),
  ).toEqual({ voices: ["voice.wav"], music: ["jingle.wav"] });
  expect(missingSources(project, project.tracks, project.music)).toEqual({
    voices: [],
    music: [],
  });
});

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
