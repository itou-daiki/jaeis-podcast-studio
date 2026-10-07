import type { ReactNode } from "react";
import { ArrowRight, Download } from "lucide-react";
import { formatTime } from "./editing";

export type Step = "source" | "edit" | "sound" | "export";
export const steps: { id: Step; label: string }[] = [
  { id: "source", label: "素材を読み込む" },
  { id: "edit", label: "不要な部分をカット" },
  { id: "sound", label: "音量・音楽を整える" },
  { id: "export", label: "確認して書き出す" },
];

export function WorkflowNav({
  step,
  hasAudio,
  onChange,
}: {
  step: Step;
  hasAudio: boolean;
  onChange: (step: Step) => void;
}) {
  return (
    <nav className="workflow-nav" aria-label="編集の手順">
      {steps.map((item, i) => (
        <button
          key={item.id}
          aria-current={step === item.id ? "step" : undefined}
          disabled={item.id !== "source" && !hasAudio}
          onClick={() => onChange(item.id)}
        >
          <span className="step-number">{i + 1}</span>
          <span>{item.label}</span>
        </button>
      ))}
    </nav>
  );
}

export function NextStep({
  step,
  onChange,
}: {
  step: Step;
  onChange: (step: Step) => void;
}) {
  const next = steps[steps.findIndex((s) => s.id === step) + 1];
  return next ? (
    <div className="step-next">
      <button className="secondary full" onClick={() => onChange(next.id)}>
        次へ：{next.label}
        <ArrowRight size={16} />
      </button>
    </div>
  ) : null;
}

const reviewItems = [
  "カットのつなぎ目で、言葉が途切れていない",
  "出演者の声と音楽の音量を聞き比べた",
  "収録前後の打ち合わせや、公開しない発言が残っていない",
];

export function DeliveryPanel({
  duration,
  cutCount,
  remaining,
  checks,
  onCheck,
  onListen,
  children,
}: {
  duration: number;
  cutCount: number;
  remaining: number;
  checks: boolean[];
  onCheck: (index: number, value: boolean) => void;
  onListen: () => void;
  children: ReactNode;
}) {
  return (
    <div className="inspector-content delivery-panel">
      <h2>書き出し前の確認</h2>
      <p className="delivery-summary">
        完成音声 <strong>{formatTime(duration)}</strong>
        <span>カット {cutCount}件</span>
      </p>
      <button className="secondary full" onClick={onListen}>
        編集後を先頭から聞く
      </button>
      <div className="review-checks">
        {reviewItems.map((label, index) => (
          <label key={label}>
            <input
              type="checkbox"
              checked={checks[index] ?? false}
              onChange={(e) => onCheck(index, e.target.checked)}
            />
            <span>{label}</span>
          </label>
        ))}
      </div>
      <p className="hint">
        確認用のメモです。未確認でも試聴用に書き出せます。音声を編集し直すとチェックは解除されます。
      </p>
      {remaining > 0 ? (
        <p className="review-warning">
          未判断のカット候補が {remaining}
          件あります。採用していない箇所は音声に残ります。
        </p>
      ) : null}
      <div className="delivery-settings">
        <h3>
          <Download size={16} />
          音声ファイルを保存
        </h3>
        {children}
      </div>
      <p className="hint">
        書き出した音声を出演者に確認してもらってから公開してください。このアプリからの送信・公開は行いません。
      </p>
    </div>
  );
}
