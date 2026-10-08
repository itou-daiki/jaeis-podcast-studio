// IDs are versioned: never replace the audio behind an existing ID. Saved edits
// must reproduce the same source and timing after an app update.
export const builtInMusic = [
  {
    id: "jaeis-opening-v1",
    name: "JAEIS オープニング",
    role: "opening",
    seconds: 12.82,
    file: "jaeis-opening-v1.wav",
    gainDb: -12,
    description: "番組の先頭に挿入",
  },
  {
    id: "jaeis-ending-v1",
    name: "JAEIS エンディング",
    role: "ending",
    seconds: 13.08,
    file: "jaeis-ending-v1.wav",
    gainDb: -12,
    description: "番組の最後に挿入",
  },
  {
    id: "jaeis-jingle-v1",
    name: "JAEIS ジングル",
    role: "jingle",
    seconds: 3.834354,
    file: "jaeis-jingle-v1.wav",
    gainDb: -12,
    description: "話題の切り替わりに挿入",
  },
  {
    id: "studio-calm-v1",
    name: "やわらかなBGM（標準）",
    role: "bgm",
    seconds: 16,
    file: undefined,
    gainDb: -26,
    description: "会話の下で静かに繰り返す合成音",
  },
] as const;

export type BuiltInMusicId = (typeof builtInMusic)[number]["id"];
export function findBuiltInMusic(id: unknown) {
  return builtInMusic.find((asset) => asset.id === id);
}
