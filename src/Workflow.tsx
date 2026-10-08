import type { ReactNode } from "react";
import { ArrowRight, Check, Download, Save } from "lucide-react";
import { formatTime } from "./editing";
import type { MusicClip } from "./types";

export type Step = "source" | "edit" | "sound" | "export";
export const steps: { id: Step; label: string }[] = [
  { id: "source", label: "素材を読み込む" },
  { id: "edit", label: "不要な部分をカット" },
  { id: "sound", label: "音量・音楽を整える" },
  { id: "export", label: "確認して書き出す" },
];

export type StepProgress = Record<Step, { text: string; done: boolean }>;

// Short status under each step so an editor who resumes after an interruption
// can see where they left off without opening every panel.
export function stepProgress({
  trackCount,
  cutCount,
  remaining,
  reviewed = false,
  music,
  duration,
  exported,
}: {
  trackCount: number;
  cutCount: number;
  remaining: number;
  // Every found candidate was cut or kept: a clean recording may need no cut.
  reviewed?: boolean;
  music: Pick<MusicClip, "role">[];
  duration: number;
  exported: boolean;
}): StepProgress {
  const jingles = music.filter((m) => m.role === "jingle").length;
  const parts = [
    music.some((m) => m.role === "opening") ? "OP" : "",
    music.some((m) => m.role === "ending") ? "ED" : "",
    jingles ? `ジングル${jingles}` : "",
    music.some((m) => m.role === "bgm") ? "BGM" : "",
  ].filter(Boolean);
  return {
    source: trackCount
      ? { text: `${trackCount}本を読み込み済み`, done: true }
      : { text: "未読み込み", done: false },
    edit: {
      text: [
        cutCount
          ? `${cutCount}件カット`
          : reviewed
            ? "候補を確認済み"
            : "カットなし",
        remaining ? `候補 残り${remaining}件` : "",
      ]
        .filter(Boolean)
        .join("・"),
      done: remaining === 0 && (cutCount > 0 || reviewed),
    },
    sound: parts.length
      ? { text: `${parts.join("・")} 追加済み`, done: true }
      : { text: "音楽なし", done: false },
    export: exported
      ? { text: "書き出し済み", done: true }
      : {
          text: trackCount ? `完成 ${formatTime(duration)}・未書き出し` : "",
          done: false,
        },
  };
}

export function WorkflowNav({
  step,
  hasAudio,
  progress,
  onChange,
}: {
  step: Step;
  hasAudio: boolean;
  progress?: StepProgress;
  onChange: (step: Step) => void;
}) {
  return (
    <nav className="workflow-nav" aria-label="編集の手順">
      {steps.map((item, i) => {
        const status = hasAudio ? progress?.[item.id] : undefined;
        return (
          <button
            key={item.id}
            aria-current={step === item.id ? "step" : undefined}
            disabled={item.id !== "source" && !hasAudio}
            onClick={() => onChange(item.id)}
          >
            <span className="step-number">{i + 1}</span>
            <span className="step-text">
              <span>{item.label}</span>
              {status?.text ? (
                <small className={status.done ? "step-status done" : "step-status"}>
                  {status.done ? <Check size={12} aria-hidden="true" /> : null}
                  {status.text}
                </small>
              ) : null}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

// The few actions of the current step, in order. Replaces scattered hints so a
// rotating editor who has forgotten the procedure can follow one list.
export function StepGuide({ items }: { items: ReactNode[] }) {
  return (
    <ol className="step-guide" aria-label="この工程でやること">
      {items.map((item, i) => (
        <li key={i}>{item}</li>
      ))}
    </ol>
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
  fileName,
  exported,
  onCheck,
  onListen,
  onSaveProject,
  children,
}: {
  duration: number;
  cutCount: number;
  remaining: number;
  checks: boolean[];
  fileName: string;
  exported: boolean;
  onCheck: (index: number, value: boolean) => void;
  onListen: () => void;
  onSaveProject: () => void;
  children: ReactNode;
}) {
  return (
    <div className="inspector-content delivery-panel">
      <h2>書き出し前の確認</h2>
      <StepGuide
        items={[
          "編集後を先頭から聞く",
          "音声ファイルを書き出す",
          "共有フォルダに置き、出演者に自分のパートの確認を依頼する",
        ]}
      />
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
        確認用のメモです。未確認でも書き出せます。音声を編集し直すとチェックは外れます。
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
        <p className="hint compact">
          ファイル名：<strong className="file-name">{fileName}</strong>
          （エピソード名から作成）
        </p>
      </div>
      {exported ? (
        <div className="after-export" role="status">
          <h3>
            <Check size={16} />
            書き出しました。次にすること
          </h3>
          <ol>
            <li>音声ファイルを共有フォルダ（確認用）に置く</li>
            <li>出演者に、自分のパートを聞いて確認してもらう</li>
            <li>修正に備えて、編集ファイルも保存しておく</li>
          </ol>
          <button className="secondary full" onClick={onSaveProject}>
            <Save size={16} />
            編集ファイルも保存
          </button>
        </div>
      ) : (
        <p className="hint">
          出演者の確認が済んでから公開してください。このアプリから配信サイトへの投稿は行いません。
        </p>
      )}
    </div>
  );
}
