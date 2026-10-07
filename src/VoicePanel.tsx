import { useState } from "react";
import { hasVoiceEffects, originalVoice, type VoiceSettings } from "./voice";

type Props = {
  name: string;
  applied?: VoiceSettings;
  onPreview: (settings?: VoiceSettings) => void;
  onApply: (settings: VoiceSettings) => void;
  onClear: () => void;
};

export function VoicePanel({
  name,
  applied,
  onPreview,
  onApply,
  onClear,
}: Props) {
  const [draft, setDraft] = useState(applied ?? originalVoice);
  const active = hasVoiceEffects(draft);
  const changed =
    JSON.stringify(draft) !== JSON.stringify(applied ?? originalVoice);
  return (
    <details className="voice-panel">
      <summary>
        ノイズ・声の調整{" "}
        <span>
          {applied ? "反映済み" : "未調整"}
          {changed ? " · 設定を変更中" : ""}
        </span>
      </summary>
      <div
        className="voice-controls"
        role="group"
        aria-label={`${name} 音質調整`}
      >
        <p className="voice-hint">
          空調などの持続的な「サーッ」を軽減します。まず弱めで試し、声がこもる場合は戻してください。話し声・咳・反響を消す機能ではありません。
        </p>
        <label className="voice-select">
          ノイズ低減
          <select
            value={draft.noise}
            onChange={(e) =>
              setDraft({
                ...draft,
                noise: e.target.value as VoiceSettings["noise"],
              })
            }
          >
            <option value="off">なし</option>
            <option value="light">弱め（おすすめ）</option>
            <option value="standard">標準</option>
            <option value="strong">強め</option>
          </select>
        </label>
        <label className="voice-check">
          <input
            type="checkbox"
            checked={draft.rumble}
            onChange={(e) => setDraft({ ...draft, rumble: e.target.checked })}
          />
          低い「ゴーッ」という音を軽減
        </label>
        <label className="voice-check">
          <input
            type="checkbox"
            checked={draft.compress}
            onChange={(e) => setDraft({ ...draft, compress: e.target.checked })}
          />
          大きな声を抑える<span>小さな声は音量スライダーで調整</span>
        </label>
        <p className="voice-hint">
          ① 原音と聞き比べ → ②
          よければ全体に反映。試聴はこの音声だけ、選択範囲か再生位置から最大10秒です。音量は上の設定を使います。
        </p>
        <div className="voice-actions">
          <button className="secondary" onClick={() => onPreview()}>
            原音を聞く
          </button>
          <button
            className="secondary"
            disabled={!active}
            onClick={() => onPreview(draft)}
          >
            調整後を試聴
          </button>
          <button
            className="primary"
            disabled={!active || !changed}
            onClick={() => onApply(draft)}
          >
            全体に反映
          </button>
          {applied ? (
            <button
              className="text-button"
              onClick={() => {
                setDraft(originalVoice);
                onClear();
              }}
            >
              音質調整を解除
            </button>
          ) : null}
        </div>
        <p className="voice-hint">
          原音・カット位置は保持します。反映済みの調整は再生と書き出しに使われます。波形は原音の表示です。
        </p>
      </div>
    </details>
  );
}
