import { afterEach, expect, test, vi } from "vitest";
import { loadBuiltInMusic, restoreMusic } from "../src/music-library";
import { readProject, saveProject } from "../src/project";

afterEach(() => vi.unstubAllGlobals());

test("a failed built-in download can be retried without losing the saved music settings", async () => {
  const buffer = { duration: 12.819841 } as AudioBuffer;
  const context = {
    decodeAudioData: async () => buffer,
  } as unknown as BaseAudioContext;
  const request = vi
    .fn()
    .mockResolvedValueOnce(new Response("unavailable", { status: 503 }))
    .mockResolvedValueOnce(new Response(new Uint8Array([1])));
  vi.stubGlobal("fetch", request);
  const saved = [
    {
      name: "JAEIS オープニング",
      duration: buffer.duration,
      role: "opening" as const,
      at: 0,
      gainDb: -20,
      builtinId: "jaeis-opening-v1",
    },
  ];
  const original = structuredClone(saved);
  await expect(restoreMusic(saved, [], context)).rejects.toThrow(
    "取得できません",
  );
  expect(saved).toEqual(original);
  const [restored] = await restoreMusic(saved, [], context);
  expect(restored).toMatchObject({ buffer, gainDb: -20 });
  expect(request).toHaveBeenCalledTimes(2);
});

test("built-in music loads without a file and shared placements restore with one download", async () => {
  // The browser's decoder and HTTP are external boundaries; the library and
  // project persistence below run unchanged.
  const buffer = { duration: 3.834376 } as AudioBuffer;
  const context = {
    decodeAudioData: async () => buffer,
  } as unknown as BaseAudioContext;
  const fetchAudio = vi.fn(
    async (_input: RequestInfo | URL) =>
      new Response(new Uint8Array([1, 2, 3])),
  );
  vi.stubGlobal("fetch", fetchAudio);
  const clip = await loadBuiltInMusic("jaeis-jingle-v1", context);
  expect(clip).toMatchObject({
    builtinId: "jaeis-jingle-v1",
    role: "jingle",
    buffer,
    gainDb: -12,
  });
  expect(String(fetchAudio.mock.calls[0][0])).toMatch(
    /\/music\/jaeis-jingle-v1\.wav$/,
  );
  const project = readProject(
    saveProject({
      version: 1,
      title: "内蔵音源",
      tracks: [],
      cuts: [],
      cues: [],
      music: [5, 15].map((at) => ({
        name: clip.name,
        duration: buffer.duration,
        role: clip.role,
        builtinId: clip.builtinId,
        assetId: clip.assetId,
        gainDb: -18,
        at,
      })),
    }),
  );
  const restored = await restoreMusic(project.music, [], context);
  expect(restored.map((m) => m.at)).toEqual([5, 15]);
  expect(restored.every((m) => m.buffer === buffer && m.gainDb === -18)).toBe(
    true,
  );
  expect(restored[0].id).not.toBe(restored[1].id);
  expect(fetchAudio).toHaveBeenCalledTimes(1);
  await expect(
    loadBuiltInMusic("https://example.com/audio", context),
  ).rejects.toThrow();
  expect(fetchAudio).toHaveBeenCalledTimes(1);
});

test("the standard background loop needs no upload or external service and restores as BGM", async () => {
  const samples: Float32Array[] = [];
  const context = {
    sampleRate: 44100,
    createBuffer(channels: number, length: number, rate: number) {
      for (let i = 0; i < channels; i++) samples.push(new Float32Array(length));
      return {
        duration: length / rate,
        getChannelData: (i: number) => samples[i],
      } as AudioBuffer;
    },
  } as BaseAudioContext;
  const fetchAudio = vi.fn();
  vi.stubGlobal("fetch", fetchAudio);
  const clip = await loadBuiltInMusic("studio-calm-v1", context);
  expect(clip.role).toBe("bgm");
  expect(clip.buffer.duration).toBe(16);
  expect(clip.gainDb).toBeLessThanOrEqual(-24);
  expect(fetchAudio).not.toHaveBeenCalled();
  expect(samples).toHaveLength(1);
  expect(
    samples[0].every((n) => Number.isFinite(n) && Math.abs(n) <= 0.8),
  ).toBe(true);
  expect(samples[0].some((n) => Math.abs(n) > 0.1)).toBe(true);
  expect(samples[0][0]).toBe(0);
  expect(samples[0].at(-1)).toBe(0);
  const project = readProject(
    saveProject({
      version: 1,
      title: "BGM",
      tracks: [],
      cuts: [],
      cues: [],
      music: [
        {
          name: clip.name,
          duration: 16,
          role: clip.role,
          builtinId: clip.builtinId,
          at: 0,
          gainDb: -29,
        },
      ],
    }),
  );
  const [restored] = await restoreMusic(project.music, [], context);
  expect(restored.buffer).toBe(clip.buffer);
  expect(restored).toMatchObject({ role: "bgm", gainDb: -29 });
});
