import { FFmpeg } from "@ffmpeg/ffmpeg";

// Single-thread core works on GitHub Pages, which cannot set COOP/COEP headers.
export async function convertMedia(
  data: Uint8Array,
  mode: "extract" | "wav" | "mp3",
  normalize: boolean,
  status: (value: string) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const ffmpeg = new FFmpeg();
  ffmpeg.on("progress", ({ progress }) =>
    status(
      `音声を${mode === "extract" ? "取り出し" : "書き出し"}中… ${Math.min(99, Math.max(0, Math.round(progress * 100)))}%`,
    ),
  );
  try {
    status("音声変換エンジンを読み込んでいます（初回 約32 MB）…");
    const base = new URL(import.meta.env.BASE_URL, location.origin);
    await ffmpeg.load({
      coreURL: new URL("vendor/ffmpeg-core.js", base).href,
      wasmURL: new URL("vendor/ffmpeg-core.wasm", base).href,
    });
    await ffmpeg.writeFile("input", data);
    const output = mode === "mp3" ? "output.mp3" : "output.wav";
    const filter = normalize ? ["-af", "loudnorm=I=-16:TP=-1.5:LRA=11"] : [];
    const code = await ffmpeg.exec(
      [
        "-i",
        "input",
        "-map",
        "0:a:0",
        "-vn",
        ...filter,
        "-ar",
        "44100",
        "-ac",
        "2",
        ...(mode === "mp3"
          ? ["-c:a", "libmp3lame", "-b:a", "192k"]
          : ["-c:a", "pcm_s16le"]),
        output,
      ],
      600000,
    );
    if (code !== 0)
      throw new Error(
        "音声変換に失敗しました。ファイル形式・サイズを確認してください。",
      );
    const result = await ffmpeg.readFile(output);
    if (typeof result === "string")
      throw new Error("音声データを取得できませんでした。");
    return new Uint8Array(result);
  } finally {
    ffmpeg.terminate();
  }
}
