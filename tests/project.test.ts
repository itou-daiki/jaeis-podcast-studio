import { expect, test } from "vitest";
import { missingSources, readProject, saveProject } from "../src/project";
import fc from "fast-check";

test("voice adjustments roundtrip and invalid settings cannot enter a restored project", () => {
  const track = {
    name: "voice.wav",
    size: 10,
    lastModified: 1,
    gainDb: 0,
    offset: 0,
    muted: false,
  };
  const project = {
    version: 1 as const,
    title: "音質",
    cuts: [],
    cues: [],
    music: [],
    tracks: [track],
  };
  expect(readProject(saveProject(project))).toEqual(project);
  const voice = { noise: "standard", rumble: true, compress: true };
  const adjusted = { ...project, tracks: [{ ...track, voice }] };
  expect(readProject(JSON.stringify(adjusted))).toEqual(adjusted);
  expect(
    readProject(
      JSON.stringify({
        ...adjusted,
        tracks: [{ ...adjusted.tracks[0], buffer: {}, processed: {} }],
      }),
    ),
  ).toEqual(adjusted);
  for (const invalid of [
    null,
    {},
    { ...voice, noise: "unknown" },
    { ...voice, rumble: "yes" },
  ]) {
    expect(() =>
      readProject(
        JSON.stringify({ ...project, tracks: [{ ...track, voice: invalid }] }),
      ),
    ).toThrow();
  }
});

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

test("script and confirmed / unconfirmed speaker states roundtrip independently", () => {
  fc.assert(
    fc.property(
      fc.string({ maxLength: 1000 }),
      fc.string({ minLength: 1, maxLength: 100 }),
      (text, name) => {
        const data = {
          version: 1 as const,
          title: "話者の確認",
          tracks: [],
          music: [],
          cuts: [],
          script: { text, name: "原稿.docx" },
          cues: [
            { start: 0, end: 1, text, speaker: name, speakerManual: true },
            { start: 1, end: 2, text, speakerManual: true },
            {
              start: 2,
              end: 3,
              text,
              speakerHint: { name, excerpt: text.slice(0, 350) },
            },
            { start: 3, end: 4, text, speakerReview: "ambiguous" as const },
          ],
        };
        expect(readProject(saveProject(data))).toEqual(data);
      },
    ),
    { numRuns: 150 },
  );
  const empty = {
    version: 1,
    title: "",
    tracks: [],
    music: [],
    cuts: [],
    cues: [],
  };
  expect(() =>
    readProject(JSON.stringify({ ...empty, script: { text: 42 } })),
  ).toThrow();
  expect(() =>
    readProject(
      JSON.stringify({ ...empty, script: { text: "x".repeat(100001) } }),
    ),
  ).toThrow();
  expect(() =>
    readProject(
      JSON.stringify({
        ...empty,
        cues: [
          {
            start: 0,
            end: 1,
            text: "a",
            speakerHint: { name: {}, excerpt: "b" },
          },
        ],
      }),
    ),
  ).toThrow();
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
