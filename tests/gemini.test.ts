import { afterEach, expect, it, vi } from "vitest";
import { geminiJson, runGeminiEdit, audioWindows } from "../src/gemini";
import type { AutoEditContext } from "../src/auto-edit";
import fc from "fast-check";

afterEach(() => vi.unstubAllGlobals());
const reply = (value: unknown) =>
  new Response(
    JSON.stringify({
      status: "completed",
      steps: [
        {
          type: "model_output",
          content: [{ type: "text", text: JSON.stringify(value) }],
        },
      ],
    }),
  );
const auth = () => ({
  key: "test-only-secret",
  model: "gemini-3.8-flash",
  signal: new AbortController().signal,
});
const empty = {
  cuts: [],
  silenceIds: [],
  jingles: [],
  summary: "会話を残しました。",
};
const context = (): AutoEditContext => ({
  duration: 10,
  cues: [{ start: 1, end: 3, text: "こんにちは" }],
  cuts: [],
  music: [],
  quiet: [],
  silences: [],
  markers: [],
});

it("uses the official host, structured output and stateless requests; the key is only in the header", async () => {
  const calls: [unknown, RequestInit | undefined][] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    calls.push([url, init]);
    return reply(empty);
  });
  expect(
    await geminiJson(auth(), "system", "data", { type: "object" }),
  ).toEqual(empty);
  const [url, request] = calls[0];
  expect(url).toBe(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
  );
  expect(request?.headers).toMatchObject({
    "x-goog-api-key": "test-only-secret",
  });
  const body = JSON.parse(request?.body as string);
  expect(body).toMatchObject({
    store: false,
    stream: false,
    response_format: { type: "text", mime_type: "application/json" },
  });
  expect(request?.body).not.toContain("test-only-secret");
  expect(request?.credentials).toBe("omit");
  expect(request?.redirect).toBe("error");
});
it("does not retry or expose provider error content, and rejects incomplete output", async () => {
  let count = 0;
  vi.stubGlobal("fetch", async () => {
    count++;
    return new Response("test-only-secret private transcript", { status: 429 });
  });
  await expect(geminiJson(auth(), "", "", {})).rejects.toThrow(/利用上限/);
  expect(count).toBe(1);
  vi.stubGlobal(
    "fetch",
    async () =>
      new Response(JSON.stringify({ status: "incomplete", steps: [] })),
  );
  await expect(geminiJson(auth(), "", "", {})).rejects.toThrow(/完了/);
});
it("returns one complete edit without mutating the input, and sends no audio when subtitles are reused", async () => {
  const ctx = context(),
    before = JSON.stringify(ctx);
  const makeAudio = vi.fn();
  vi.stubGlobal("fetch", async () => reply(empty));
  const result = await runGeminiEdit({
    ...auth(),
    context: ctx,
    script: "",
    reuseTranscript: true,
    makeAudio,
    status: () => {},
  });
  expect(makeAudio).not.toHaveBeenCalled();
  expect(result.cues).toEqual(ctx.cues);
  expect(JSON.stringify(ctx)).toBe(before);
  expect(JSON.stringify(result)).not.toContain("test-only-secret");
});
it("leaves the input unchanged if transcription succeeds but editing fails or is cancelled", async () => {
  const ctx = context(),
    before = JSON.stringify(ctx);
  let count = 0;
  vi.stubGlobal("fetch", async () =>
    ++count === 1
      ? reply({
          segments: [{ start: 1, end: 3, text: "話しました", speaker: "" }],
        })
      : new Response("error", { status: 500 }),
  );
  await expect(
    runGeminiEdit({
      ...auth(),
      context: ctx,
      script: "",
      reuseTranscript: false,
      makeAudio: async () => new Uint8Array([1]),
      status: () => {},
    }),
  ).rejects.toThrow();
  expect(JSON.stringify(ctx)).toBe(before);
  const controller = new AbortController();
  controller.abort();
  await expect(
    runGeminiEdit({
      ...auth(),
      signal: controller.signal,
      context: ctx,
      script: "",
      reuseTranscript: true,
      makeAudio: async () => new Uint8Array(),
      status: () => {},
    }),
  ).rejects.toMatchObject({ name: "AbortError" });
  expect(count).toBe(2);
});
it("audio chunks partition the recording without gaps, overlaps or unbounded payloads", () => {
  fc.assert(
    fc.property(fc.integer({ min: 1, max: 2700 }), (duration) => {
      const windows = audioWindows(duration, []);
      expect(windows[0].start).toBe(0);
      expect(windows.at(-1)?.end).toBe(duration);
      windows.forEach((range, i) => {
        expect(range.end - range.start).toBeGreaterThan(0);
        expect(range.end - range.start).toBeLessThanOrEqual(180);
        if (i) expect(range.start).toBe(windows[i - 1].end);
      });
    }),
  );
});
