import { useRef } from "react";
import { Upload, Check } from "lucide-react";
import type { SavedScript } from "./project";
import {
  MAX_SCRIPT_LENGTH,
  clearSpeakerHint,
  confirmSpeaker,
  type ParsedScript,
} from "./speakers";
import type { Cue } from "./types";

export function ScriptPanel({
  script,
  parsed,
  hasCues,
  onChange,
  onImport,
  onMatch,
}: {
  script: SavedScript | undefined;
  parsed: ParsedScript;
  hasCues: boolean;
  onChange: (script: SavedScript | undefined) => void;
  onImport: (file: File) => void;
  onMatch: () => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <details className="script-panel">
      <summary>
        原稿で話者・ジングル位置を推定 <span>任意</span>
      </summary>
      <p className="hint">
        原稿がなくても文字起こしできます。原稿があれば、似た発言から先生の名前やジングルの挿入位置を探せます。声そのものを識別する機能ではありません。
      </p>
      <button className="secondary full" onClick={() => input.current?.click()}>
        <Upload size={15} />
        Word・テキストを読み込む
      </button>
      <input
        ref={input}
        type="file"
        className="hidden"
        aria-label="原稿ファイル"
        accept=".docx,.txt,.md"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onImport(file);
          e.target.value = "";
        }}
      />
      <p className="hint compact">
        .docx / .txt / .md · 10 MB・10万文字まで。原稿は外部へ送信しません。
      </p>
      <label className="script-label">
        原稿の本文（直接貼り付けも可）
        <textarea
          aria-label="原稿の本文"
          maxLength={MAX_SCRIPT_LENGTH}
          rows={6}
          placeholder={
            "【田中先生】\n私の授業では…\n※ここでジングル\n【佐藤先生】\n私の場合は…"
          }
          value={script?.text ?? ""}
          onChange={(e) =>
            onChange({
              text: e.target.value,
              ...(script?.name ? { name: script.name } : {}),
            })
          }
        />
      </label>
      {script?.name ? (
        <p className="hint compact script-filename">読込元：{script.name}</p>
      ) : null}
      <p className="hint compact">
        名前は【田中先生】や「田中先生：」で区切ります。注釈は発言の照合から除き、「♪ジングル♪」は配置指示として残します。挿入位置は「3
        音量・音楽を整える」で確認できます。
      </p>
      {script?.text ? (
        <>
          <p className="script-names">
            読み取った話者：
            {parsed.speakers.join("、") ||
              "なし（名前の区切りを確認してください）"}
          </p>
          <details className="script-preview">
            <summary>読み取り結果を確認</summary>
            <p className="hint">
              誤った区切りや注釈があれば、上の本文を直してください。自由な形式の注釈は読み分けられないことがあります。
            </p>
            {parsed.turns.slice(0, 30).map((turn, i) => (
              <p key={i}>
                <strong>{turn.speaker}</strong>
                <br />
                {turn.text.slice(0, 350)}
                {turn.text.length > 350 ? "…" : ""}
              </p>
            ))}
            {parsed.turns.length > 30 ? (
              <p>先頭30区間を表示しています。</p>
            ) : null}
            <h3>
              ジングルの配置指示：
              {parsed.sequence.filter((s) => s.kind === "jingle").length}件
            </h3>
            <h3>注釈などとして除外：{parsed.excluded.length}件</h3>
            <pre>{parsed.excluded.slice(0, 30).join("\n") || "なし"}</pre>
            <h3>話者の区切りがない本文：{parsed.unassigned.length}行</h3>
            <pre>{parsed.unassigned.slice(0, 30).join("\n") || "なし"}</pre>
          </details>
          <button
            className="secondary full"
            disabled={!hasCues || !parsed.turns.length}
            onClick={onMatch}
          >
            原稿から話者候補を探す
          </button>
          <p className="hint compact">
            原稿を先に入れると、文字起こし・字幕読込の後に自動で照合します。確定済みの名前は上書きしません。
          </p>
          <button className="text-button" onClick={() => onChange(undefined)}>
            原稿と未確定の候補を取り除く
          </button>
        </>
      ) : null}
    </details>
  );
}

const reasons = {
  short: "短い発言のため、話者を推定していません。",
  unmatched: "原稿との十分な一致がありません。",
  ambiguous: "複数の話者が考えられます。音声を確認してください。",
};

export function CueSpeaker({
  cue,
  label,
  onChange,
}: {
  cue: Cue;
  label: string;
  onChange: (cue: Cue) => void;
}) {
  return (
    <div className="cue-speaker">
      <label>
        話者
        <input
          aria-label={`${label} の話者`}
          list="speaker-names"
          maxLength={100}
          placeholder="未設定（名前を入力）"
          value={cue.speaker ?? ""}
          onChange={(e) => onChange(confirmSpeaker(cue, e.target.value))}
        />
      </label>
      {cue.speakerHint && !cue.speaker && !cue.speakerManual ? (
        <div className="speaker-suggestion">
          <div>
            <span>候補：{cue.speakerHint.name}</span>
            <button
              className="text-button"
              onClick={() =>
                onChange(confirmSpeaker(cue, cue.speakerHint!.name))
              }
            >
              <Check size={13} />
              この名前で確定
            </button>
          </div>
          <details>
            <summary>照合した原稿</summary>
            <p>{cue.speakerHint.excerpt}</p>
          </details>
          <button
            className="text-button"
            onClick={() => onChange(confirmSpeaker(cue, ""))}
          >
            この候補を使わない
          </button>
        </div>
      ) : null}
      {cue.speakerReview && !cue.speaker ? (
        <p className="hint compact">{reasons[cue.speakerReview]}</p>
      ) : null}
      {cue.speakerManual && !cue.speaker ? (
        <button
          className="text-button"
          onClick={() => {
            const { speakerManual: _manual, ...rest } = clearSpeakerHint(cue);
            onChange(rest);
          }}
        >
          この発言を再照合の対象に戻す
        </button>
      ) : null}
    </div>
  );
}
