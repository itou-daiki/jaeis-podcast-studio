import type { ScriptJob } from "./script.worker";
import type { Cue } from "./types";

export function scriptJob(
  job: Extract<ScriptJob, { type: "file" }>,
): Promise<string>;
export function scriptJob(
  job: Extract<ScriptJob, { type: "match" }>,
): Promise<Cue[]>;
export function scriptJob(job: ScriptJob): Promise<string | Cue[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./script.worker.ts", import.meta.url), {
      type: "module",
    });
    const finish = () => {
      clearTimeout(timer);
      worker.terminate();
    };
    const timer = setTimeout(() => {
      finish();
      reject(
        new Error(
          "原稿の処理に時間がかかっています。今回使う部分だけに短くするか、テキストを貼り付けてください。",
        ),
      );
    }, 30_000);
    worker.onmessage = ({ data }) => {
      finish();
      if (data.error) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = () => {
      finish();
      reject(
        new Error(
          "原稿の処理を開始できません。編集を保存してから画面を再読み込みし、もう一度お試しください。",
        ),
      );
    };
    worker.postMessage(job, job.type === "file" ? [job.bytes] : []);
  });
}
