import { readScriptFile } from "./script-file";
import { parseScript, suggestSpeakers } from "./speakers";
import type { Cue } from "./types";
import { suggestJingles } from "./jingles";

export type ScriptJob =
  | { type: "file"; name: string; bytes: ArrayBuffer }
  | { type: "match"; text: string; cues: Cue[] }
  | { type: "jingles"; text: string; cues: Cue[]; duration: number };
self.onmessage = async ({ data }: MessageEvent<ScriptJob>) => {
  try {
    const result =
      data.type === "file"
        ? await readScriptFile(data.name, data.bytes)
        : data.type === "jingles"
          ? suggestJingles(parseScript(data.text), data.cues, data.duration)
          : suggestSpeakers(data.cues, parseScript(data.text));
    self.postMessage({ result });
  } catch (error) {
    self.postMessage({
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
