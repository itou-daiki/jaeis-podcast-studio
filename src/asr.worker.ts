import {
  env,
  pipeline,
  WhisperTextStreamer,
  type WhisperTokenizer,
} from "@huggingface/transformers";
import type { Cue } from "./types";

env.allowLocalModels = false;
// Pages cannot provide cross-origin isolation; keep ONNX in one worker/thread.
env.backends.onnx.wasm!.numThreads = 1;
env.backends.onnx.wasm!.proxy = false;
env.backends.onnx.wasm!.wasmPaths = new URL(
  `${import.meta.env.BASE_URL}vendor/onnx/`,
  self.location.origin,
).href;

self.onmessage = async (
  event: MessageEvent<{ audio: Float32Array; model: string; offset: number }>,
) => {
  try {
    const { audio, model, offset } = event.data;
    if (
      ![
        "onnx-community/whisper-base",
        "onnx-community/whisper-small",
        "onnx-community/whisper-tiny",
      ].includes(model)
    )
      throw new Error("未対応のモデルです。");
    const transcriber = await pipeline("automatic-speech-recognition", model, {
      dtype: "q8",
      device: "wasm",
      progress_callback: (p) => {
        if (p.status === "progress")
          self.postMessage({
            type: "progress",
            message: `モデルを取得中: ${p.file} ${Math.round(p.progress)}%`,
          });
        if (p.status === "initiate")
          self.postMessage({
            type: "progress",
            message: "文字起こしモデルを準備しています…",
          });
      },
    });
    let chunks = 0;
    const streamer = new WhisperTextStreamer(
      transcriber.tokenizer as WhisperTokenizer,
      {
        skip_prompt: true,
        on_finalize: () => {
          chunks++;
          self.postMessage({
            type: "progress",
            message: `日本語を文字起こし中… 約${Math.min(99, Math.round(((chunks * 20) / (audio.length / 16000)) * 100))}%`,
          });
        },
      },
    );
    self.postMessage({
      type: "progress",
      message: "日本語を文字起こし中…（音声はこの端末から送信されません）",
    });
    const output = await transcriber(audio, {
      language: "japanese",
      task: "transcribe",
      return_timestamps: true,
      chunk_length_s: 30,
      stride_length_s: 5,
      streamer,
    });
    const result = Array.isArray(output) ? output[0] : output;
    const cues: Cue[] = (result.chunks ?? []).flatMap(
      (chunk: { timestamp: [number | null, number | null]; text: string }) => {
        const start = chunk.timestamp[0],
          end = chunk.timestamp[1] ?? audio.length / 16000;
        if (start === null || end <= start || !chunk.text.trim()) return [];
        // Whisper can hallucinate on silence; don't turn those into cut instructions.
        let max = 0;
        for (
          let i = Math.floor(start * 16000);
          i < Math.min(audio.length, end * 16000);
          i += 16
        )
          max = Math.max(max, Math.abs(audio[i]));
        return max < 0.001
          ? []
          : [
              {
                start: offset + start,
                end: offset + Math.min(end, audio.length / 16000),
                text: chunk.text.trim(),
              },
            ];
      },
    );
    self.postMessage({ type: "complete", cues });
    await transcriber.dispose();
  } catch (error) {
    self.postMessage({
      type: "error",
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
