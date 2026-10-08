import { useState } from "react";
import { ArrowRight, ExternalLink, Undo2 } from "lucide-react";
import { DEFAULT_GEMINI_MODEL } from "./gemini";
import type { AutoEditResult } from "./auto-edit";

const apiKeyGuide = (
  <section className="auto-key-guide" aria-labelledby="gemini-key-guide-title">
    <h3 id="gemini-key-guide-title">APIキーの取得方法</h3>
    <a
      className="auto-key-link"
      href="https://aistudio.google.com/apikey"
      target="_blank"
      rel="noopener noreferrer"
    >
      Google AI StudioでAPIキーを取得
      <ExternalLink size={15} aria-hidden="true" />
      <span>（別タブで開きます）</span>
    </a>
    <ol id="gemini-key-steps">
      <li>上のリンクを開き、Googleアカウントでログインします。</li>
      <li>
        「APIキーを作成」（Create API
        key）を選びます。すでにキーがある場合は、そのキーを使えます。
      </li>
      <li>キーをコピーし、この下の「自分のGemini APIキー」に貼り付けます。</li>
    </ol>
    <p className="hint">
      作成画面やプロジェクトの選択で迷ったら、
      <a
        href="https://ai.google.dev/gemini-api/docs/api-key?hl=ja"
        target="_blank"
        rel="noopener noreferrer"
      >
        Google公式の取得手順（日本語・別タブ）
      </a>
      を確認してください。学校のアカウントでは管理者の許可が必要な場合があります。
    </p>
  </section>
);

export type AutoEditOptions = {
  key: string;
  model: string;
  reuseTranscript: boolean;
  exportMp3: boolean;
};
export function AutoEditPanel({
  duration,
  hasTranscript,
  hasScript,
  hasMusic,
  disabled,
  result,
  canUndo,
  onRun,
  onUndo,
  onSetup,
}: {
  duration: number;
  hasTranscript: boolean;
  hasScript: boolean;
  hasMusic: boolean;
  disabled: boolean;
  result?: AutoEditResult;
  canUndo: boolean;
  onRun: (options: AutoEditOptions) => Promise<void>;
  onUndo: () => void;
  onSetup: (step: "edit" | "sound") => void;
}) {
  // Deliberately component memory only. Never put credentials in a project or browser storage.
  const [key, setKey] = useState("");
  const [model, setModel] = useState(DEFAULT_GEMINI_MODEL);
  const [reuse, setReuse] = useState(true),
    [exportMp3, setExportMp3] = useState(true);
  const [consent, setConsent] = useState(false);
  const sendsAudio = !hasTranscript || !reuse;
  return (
    <section className="auto-edit" aria-label="Geminiフルオート編集">
      <details>
        <summary>
          <strong>Geminiでフルオート編集</strong>
          <span>任意 · APIキーが必要</span>
        </summary>
        <div className="auto-edit-body">
          <p className="auto-lead">
            会話を読み取り、不要な発言のカットから音楽の配置・MP3の書き出しまでまとめて行います。
          </p>
          <p className="hint">
            原稿にない会話も残します。曖昧なカットは保留。元音声は変更せず、あとから秒単位で直せます。
          </p>
          <div className="auto-preparation">
            <button className="text-button" onClick={() => onSetup("edit")}>
              原稿：{hasScript ? "設定済み" : "なし（任意で追加）"}
            </button>
            <button className="text-button" onClick={() => onSetup("sound")}>
              音楽：
              {hasMusic
                ? "追加済み・用途を確認"
                : "なし（OP・ED・ジングルを追加）"}
            </button>
          </div>
          <p className="hint">
            ジングルは原稿の指定位置に配置します。音源や原稿の指定がなければ追加しません。OP・EDは「音を整える」で用途を設定してください。
          </p>
          {apiKeyGuide}
          <div className="auto-key-row">
            <label htmlFor="gemini-key">
              自分のGemini APIキー
              <input
                id="gemini-key"
                type="password"
                aria-describedby="gemini-key-steps gemini-key-safety"
                value={key}
                onChange={(e) => {
                  setKey(e.target.value);
                  setConsent(false);
                }}
                autoComplete="off"
                spellCheck={false}
                maxLength={512}
                placeholder="取得したAPIキーをここに貼り付ける"
              />
            </label>
            <button
              className="secondary"
              disabled={!key}
              onClick={() => {
                setKey("");
                setConsent(false);
              }}
            >
              キーを消去
            </button>
          </div>
          <p className="hint" id="gemini-key-safety">
            キーはチャットやDiscordに貼らないでください。このアプリでは保存・共有せず、タブ内のメモリだけで扱い、処理後またはタブを閉じると消去します。ブラウザ内では完全に秘匿できません。信頼できる端末で自分のキーを使い、Gemini専用のAPI制限・利用上限を設定してください。
          </p>
          <details className="auto-options">
            <summary>処理の設定</summary>
            <label htmlFor="gemini-model">
              モデルID
              <input
                id="gemini-model"
                value={model}
                maxLength={87}
                onChange={(e) => {
                  setModel(e.target.value);
                  setConsent(false);
                }}
              />
            </label>
            <label className="auto-check">
              <input
                type="checkbox"
                checked={reuse && hasTranscript}
                disabled={!hasTranscript}
                onChange={(e) => {
                  setReuse(e.target.checked);
                  setConsent(false);
                }}
              />
              今ある字幕を使う（音声は送らない）
            </label>
            <label className="auto-check">
              <input
                type="checkbox"
                checked={exportMp3}
                onChange={(e) => setExportMp3(e.target.checked)}
              />
              音量を整えてMP3まで書き出す
            </label>
          </details>
          <div className="auto-disclosure">
            <strong>Googleへ送信する内容</strong>
            <p>
              {sendsAudio
                ? "ミュートしていない声の音声（最大3分ずつ）、そこから作った字幕"
                : "現在の字幕（話者名を含む）"}
              、原稿、無音・カットの時刻。音楽ファイル・動画の映像は送りません。
            </p>
            <p>
              API呼び出しは
              {sendsAudio
                ? `最大${Math.ceil(duration / 172) + 1}回程度`
                : "1回"}
              。利用量に応じて料金が発生します。中止しても送信済みの処理は課金される場合があります。
            </p>
            <p>
              無料枠では入力がサービス改善や人による確認に使われる場合があります。個人情報・非公開の会話は無料枠に送らず、契約と出演者の同意を確認してください。
            </p>
            <p>
              <a
                href="https://ai.google.dev/gemini-api/terms"
                target="_blank"
                rel="noreferrer"
              >
                データの取り扱い
              </a>{" "}
              ·{" "}
              <a
                href="https://ai.google.dev/gemini-api/docs/pricing"
                target="_blank"
                rel="noreferrer"
              >
                料金
              </a>
            </p>
          </div>
          <label className="auto-check">
            <input
              type="checkbox"
              checked={consent}
              onChange={(e) => setConsent(e.target.checked)}
            />
            送信内容・出演者の同意・契約を確認し、Googleへの送信とAPI利用料の負担に同意します。
          </label>
          <button
            className="primary"
            disabled={disabled || !key.trim() || !model.trim() || !consent}
            onClick={async () => {
              const options = {
                key: key.trim(),
                model: model.trim(),
                reuseTranscript: reuse && hasTranscript,
                exportMp3,
              };
              setConsent(false);
              try {
                await onRun(options);
              } finally {
                setKey("");
              }
            }}
          >
            フルオート編集を開始 <ArrowRight size={16} />
          </button>
          <p className="hint">
            全処理が成功してから反映します。編集後の試聴は必要です。配信サイトへの投稿は行いません。
          </p>
        </div>
      </details>
      {result ? (
        <div className="auto-result" role="status">
          <div className="auto-result-heading">
            <strong>
              AI編集を反映：カット{result.addedCuts}か所・ジングル
              {result.addedJingles}か所
            </strong>
            <button className="secondary" disabled={!canUndo} onClick={onUndo}>
              <Undo2 size={15} />
              AI編集前に戻す
            </button>
          </div>
          <p>AIの編集方針：{result.summary}</p>
          {result.held.length ? (
            <details>
              <summary>残した箇所・確認事項（{result.held.length}件）</summary>
              <ul>
                {result.held.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="hint">
            カット前後を試聴してください。一括取り消しはこのタブを開いている間だけ使えます。
          </p>
        </div>
      ) : null}
    </section>
  );
}
