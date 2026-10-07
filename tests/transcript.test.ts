import { expect, test } from "vitest";
import { parseTranscript, detectRetakes, toSrt } from "../src/transcript";

test("Zoom VTT preserves speaker, timestamps and multiline speech", () => {
  expect(
    parseTranscript(
      "WEBVTT\n\n1\n00:00:03.000 --> 00:00:05.500\n伊藤: こんにちは\nよろしくお願いします\n",
    ),
  ).toEqual([
    {
      start: 3,
      end: 5.5,
      speaker: "伊藤",
      text: "こんにちは よろしくお願いします",
    },
  ]);
});

test("retake markers are proposals, but quoted examples and another speaker repeating are not", () => {
  expect(
    detectRetakes([{ start: 2, end: 4, text: "ちょっとやり直します" }])[0]
      .reason,
  ).toBe("やり直しの発言");
  expect(
    detectRetakes([
      { start: 0, end: 2, text: "「やり直しましょう」という話をします" },
    ]),
  ).toEqual([]);
  const text = "生徒が自分で学習方法を選べることが大事だと思います";
  expect(
    detectRetakes([
      { start: 0, end: 5, text, speaker: "A" },
      { start: 6, end: 11, text, speaker: "B" },
    ]),
  ).toEqual([]);
  expect(
    detectRetakes([
      { start: 0, end: 5, text, speaker: "A" },
      { start: 6, end: 11, text, speaker: "A" },
    ]),
  ).toHaveLength(1);
});

test("subtitle serialization retains time and speech", () => {
  const cues = [
    { start: 3.025, end: 3605.56, speaker: "伊藤", text: "これはテストです。" },
  ];
  expect(parseTranscript(toSrt(cues))).toEqual(cues);
  expect(() =>
    parseTranscript('[{"start":2,"end":1,"text":"invalid"}]'),
  ).toThrow();
});
