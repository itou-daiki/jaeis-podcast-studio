import { expect, test } from "vitest";
import fc from "fast-check";
import {
  clearSpeakerHint,
  confirmSpeaker,
  parseScript,
  suggestSpeakers,
} from "../src/speakers";
import type { Cue } from "../src/types";

test("script separates named speech from directions, placeholders, and discussion", () => {
  const parsed = parseScript(`**【司会】**
みなさんこんにちは。今日は授業づくりのお話です。
♪ジングル♪
【田中先生】
授業のスライド（家庭でも使えます）をすべて公開しています。（少し間を置く）
※編集時に音量を調整する
＜コメントや他の先生方からの質問等＞
続いて、佐藤先生に伺います。
【佐藤先生】
○○○○○○○○○
生徒が自分で学び方を選べることを大切にしています。
山田先生：試作品を作って意見をもらい、改善を重ねています。`);
  expect(parsed.speakers).toEqual(["司会", "田中先生", "佐藤先生", "山田先生"]);
  expect(parsed.turns.map(({ speaker, text }) => ({ speaker, text }))).toEqual([
    {
      speaker: "司会",
      text: "みなさんこんにちは。今日は授業づくりのお話です。",
    },
    {
      speaker: "田中先生",
      text: "授業のスライド（家庭でも使えます）をすべて公開しています。",
    },
    {
      speaker: "佐藤先生",
      text: "生徒が自分で学び方を選べることを大切にしています。",
    },
    {
      speaker: "山田先生",
      text: "試作品を作って意見をもらい、改善を重ねています。",
    },
  ]);
  expect(parsed.excluded.length).toBeGreaterThan(3);
  expect(parsed.unassigned).toEqual(["続いて、佐藤先生に伺います。"]);
});

const script = `【田中先生】
教材の写真を拡大すると、細かい部分までじっくり観察できるのが便利ですね。
【佐藤先生】
校庭の植物を撮影して、生徒が気づいた違いを持ち寄る活動を行っています。
【山田先生】
校内の案内図を見比べながら、初めて来る人にわかりやすい道順を話し合っています。`;
const cue = (text: string): Cue => ({ start: 3, end: 10, text });

test("script matching tolerates modest deviations and reordered turns, without rewriting speech", () => {
  const source = [
    cue(
      "校庭の植物を写真に撮って、生徒が気づいた違いを持ち寄る活動を行っています。",
    ),
    cue(
      "あの、教材の写真を拡大すると、細かいところまでじっくり観察できるのが便利ですね。",
    ),
  ];
  const result = suggestSpeakers(source, parseScript(script));
  expect(result.map((c) => c.speakerHint?.name)).toEqual([
    "佐藤先生",
    "田中先生",
  ]);
  expect(result.map(({ start, end, text }) => ({ start, end, text }))).toEqual(
    source,
  );
  expect(result.every((c) => c.speaker === undefined)).toBe(true);
});

test("off-script, short, shared, and mixed-speaker speech remains unassigned", () => {
  const shared =
    "情報の授業を通じて、生徒が自分で考える力を育てたいと思います。";
  const parsed = parseScript(
    `${script}\n【司会】${shared}\n【別の先生】${shared}`,
  );
  const result = suggestSpeakers(
    [
      cue("はい、ありがとうございます。"),
      cue(
        "週末に遠足に出かけたら突然雨が降り始めて、近くのお店で雨宿りをしていました。",
      ),
      cue(shared),
      cue(
        "校庭の植物を撮影して、生徒が気づいた違いを持ち寄る活動を行っています。校内の案内図を見比べながら、初めて来る人にわかりやすい道順を話し合っています。",
      ),
    ],
    parsed,
  );
  expect(result.every((c) => !c.speaker && !c.speakerHint)).toBe(true);
  expect(result.map((c) => c.speakerReview)).toEqual([
    "short",
    "unmatched",
    "ambiguous",
    "ambiguous",
  ]);
});

test("manual and imported identities are preserved, and stale suggestions are replaced", () => {
  const text =
    "校庭の植物を撮影して、生徒が気づいた違いを持ち寄る活動を行っています。";
  const matched = suggestSpeakers([cue(text)], parseScript(script))[0];
  expect(matched.speakerHint?.name).toBe("佐藤先生");
  const manual = confirmSpeaker(matched, "担当の先生");
  const unknown = confirmSpeaker(matched, "");
  expect(
    suggestSpeakers(
      [manual, unknown, { ...cue(text), speaker: "字幕の先生" }],
      parseScript(script),
    ),
  ).toEqual([manual, unknown, { ...cue(text), speaker: "字幕の先生" }]);
  expect(
    suggestSpeakers([matched], parseScript(""))[0].speakerHint,
  ).toBeUndefined();
  expect(clearSpeakerHint(matched)).toEqual(cue(text));
});

test("speaker suggestions preserve all cue text and times under arbitrary edits", () => {
  const parsed = parseScript(script);
  fc.assert(
    fc.property(
      fc.array(
        fc.record({
          start: fc.nat(2000),
          length: fc.integer({ min: 1, max: 60 }),
          text: fc.string({ maxLength: 120 }),
        }),
        { maxLength: 20 },
      ),
      (items) => {
        const source = items.map(({ start, length, text }) => ({
          start,
          end: start + length,
          text,
        }));
        const result = suggestSpeakers(source, parsed);
        expect(
          result.map(({ start, end, text }) => ({ start, end, text })),
        ).toEqual(source);
        expect(suggestSpeakers(result, parsed)).toEqual(result);
      },
    ),
    { numRuns: 150 },
  );
});

test("ordinary parentheses remain speech, unknown headings do not become teachers", () => {
  const parsed = parseScript(
    "【テーマ】\n授業デザイン\n【田中先生】こんにちは。（家庭でも使います）\n【注釈】\nここでジングルを入れる\n",
  );
  expect(parsed.speakers).toEqual(["田中先生"]);
  expect(parsed.turns[0].text).toBe("こんにちは。（家庭でも使います）");
  expect(parseScript("話者の区切りがない原稿です。").turns).toEqual([]);
});

test("annotation headings and pause labels are not treated as speakers", () => {
  const parsed = parseScript(
    "【田中先生】撮影した写真をみんなで見比べています。\n【補足】\n先生への確認事項です。\n[笑]\n【佐藤先生】一人ひとりの気づきを黒板に並べています。\n【質問】\n感想を聞く",
  );
  expect(parsed.speakers).toEqual(["田中先生", "佐藤先生"]);
  expect(parsed.turns).toHaveLength(2);
});

test("adding explicit note lines never adds spoken text", () => {
  fc.assert(
    fc.property(
      fc.array(fc.string({ maxLength: 40 }), { maxLength: 15 }),
      (notes) => {
        const speech = "授業スライドは家庭でも確認できるように公開しています。";
        const script = `【田中先生】\n${notes.map((s) => "※" + s.replace(/[\r\n\u2028\u2029]/g, "")).join("\n")}\n${speech}`;
        expect(
          parseScript(script)
            .turns.map((t) => t.text)
            .join(""),
        ).toBe(speech);
      },
    ),
    { numRuns: 150 },
  );
});
