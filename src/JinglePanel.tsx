import { useState } from "react";
import { formatTime } from "./editing";
import { scriptJob } from "./script-jobs";
import type { JingleSuggestion } from "./jingles";
import type { Cue, Cut, MusicClip } from "./types";

export function JinglePanel({
  text,
  cues,
  duration,
  cuts,
  music,
  pendingSource,
  playhead,
  onOpenScript,
  onLoadMusic,
  onPlace,
  onPreview,
}: {
  text: string;
  cues: Cue[];
  duration: number;
  cuts: Cut[];
  music: MusicClip[];
  pendingSource?: MusicClip;
  playhead: number;
  onOpenScript: () => void;
  onLoadMusic: () => void;
  onPlace: (source: string, key: string, at: number) => void;
  onPreview: (at: number, edited: boolean) => void;
}) {
  const [result, setResult] = useState<{
    text: string;
    cues: Cue[];
    duration: number;
    items: JingleSuggestion[];
  }>();
  const [positions, setPositions] = useState<Record<string, string>>({});
  const [sourceId, setSourceId] = useState("");
  const [searching, setSearching] = useState(false),
    [error, setError] = useState("");
  const sources = [
    ...(pendingSource ? [pendingSource] : []),
    ...music.filter((m) => m.role === "jingle"),
  ];
  const source = sources.find((m) => m.id === sourceId) ?? sources[0];
  const fresh =
    result?.text === text &&
    result?.cues === cues &&
    result?.duration === duration;
  async function search() {
    setSearching(true);
    setError("");
    try {
      const items = await scriptJob({ type: "jingles", text, cues, duration });
      setResult({ text, cues, duration, items });
      setPositions({});
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  }
  return (
    <section className="jingle-panel" aria-label="原稿のジングル指定">
      <h3>原稿の指定からジングルを配置</h3>
      <p className="hint">
        「♪ジングル♪」の前後を文字起こしと照合します。原稿と違う話し方でも候補を探し、曖昧な位置は保留します。
      </p>
      <button className="text-button" onClick={onOpenScript}>
        {text ? "原稿・文字起こしを確認" : "原稿・文字起こしを読み込む"}
      </button>
      {!cues.length ? (
        <p className="hint">
          先に文字起こしをするか、Zoom字幕・Whisper JSONを読み込んでください。
        </p>
      ) : null}
      {sources.length ? (
        <label className="jingle-source">
          使用するジングル
          <select
            aria-label="原稿に配置するジングル"
            value={source?.id ?? ""}
            onChange={(e) => setSourceId(e.target.value)}
          >
            {sources.map((m, i) => (
              <option key={m.id} value={m.id}>
                {i + 1}. {m.name}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <button className="secondary full" onClick={onLoadMusic}>
          ジングル音源を読み込む
        </button>
      )}
      {pendingSource ? (
        <p className="hint">
          音源は準備済みです。「この位置に配置」を押すまで再生・書き出しに入りません。配置前に画面を閉じた場合は音源を選び直してください。
        </p>
      ) : null}
      <button
        className="secondary full"
        disabled={!text.trim() || !cues.length || searching}
        onClick={() => void search()}
      >
        {searching ? "原稿と発言を照合中…" : "原稿から挿入候補を探す"}
      </button>
      {error ? (
        <p role="alert" className="hint">
          {error}
        </p>
      ) : null}
      {result && !fresh ? (
        <p className="hint" role="status">
          原稿・文字起こしが変わりました。候補を探し直してください。採用済みの音楽は移動しません。
        </p>
      ) : null}
      {fresh ? (
        <>
          <p className="hint">
            原稿の指定：{result!.items.length}か所。
            {!result!.items.length
              ? "「♪ジングル♪」を原稿に記入してください。"
              : "採用するまで新しい位置には配置しません。"}
          </p>
          {source && !source.scriptJingleKey && source !== pendingSource ? (
            <p className="hint">
              最初の採用で、選んだ音源をその位置へ移動します。2か所目以降は同じ音源を複製します。
            </p>
          ) : null}
          <div className="jingle-suggestions">
            {result!.items.map((item, i) => {
              const placed = music.find((m) => m.scriptJingleKey === item.key);
              const cutNearby =
                item.context &&
                cuts.some(
                  (c) =>
                    c.start < item.context!.end && c.end > item.context!.start,
                );
              const value =
                positions[item.key] ??
                (cutNearby || item.at === undefined ? "" : item.at.toFixed(3));
              const at = value.trim() ? Number(value) : NaN;
              const insideCut = cuts.some((c) => at > c.start && at < c.end);
              const valid =
                Number.isFinite(at) && at >= 0 && at <= duration && !insideCut;
              return (
                <article
                  className="jingle-suggestion"
                  key={item.key}
                  aria-label={`原稿ジングル ${i + 1}`}
                >
                  <strong>
                    ジングル {i + 1}{" "}
                    <small>
                      原稿 {item.line}行目 ·{" "}
                      {placed
                        ? "配置済み"
                        : item.status === "matched" && !cutNearby
                          ? "候補あり"
                          : "要確認"}
                    </small>
                  </strong>
                  <p className="jingle-context">
                    前：{item.before || "（前のセリフなし）"}
                    <br />
                    後：{item.after || "（後のセリフなし）"}
                  </p>
                  <p className="hint">
                    {cutNearby
                      ? "照合した発言の付近にカットがあります。編集後を聞いて位置を指定してください。"
                      : item.reason}
                  </p>
                  {placed ? (
                    <>
                      <p>配置位置：{formatTime(placed.at, true)}（元音声）</p>
                      <button
                        className="secondary"
                        onClick={() => onPreview(placed.at, true)}
                      >
                        挿入後を聞く
                      </button>
                      <p className="hint">
                        下の音源設定で位置を微調整・削除できます。
                      </p>
                    </>
                  ) : (
                    <>
                      <label>
                        挿入位置（元音声・秒）
                        <input
                          type="number"
                          min={0}
                          max={duration}
                          step={0.1}
                          aria-label={`ジングル ${i + 1} の候補位置（秒）`}
                          value={value}
                          placeholder="未確定"
                          onChange={(e) =>
                            setPositions((p) => ({
                              ...p,
                              [item.key]: e.target.value,
                            }))
                          }
                        />
                      </label>
                      <button
                        className="text-button"
                        onClick={() =>
                          setPositions((p) => ({
                            ...p,
                            [item.key]: playhead.toFixed(3),
                          }))
                        }
                      >
                        現在の再生位置を使う
                      </button>
                      {insideCut ? (
                        <p className="hint">
                          この位置はカット範囲内です。前後の残す位置を指定してください。
                        </p>
                      ) : null}
                      <div className="jingle-actions">
                        <button
                          className="secondary"
                          disabled={!valid}
                          onClick={() => onPreview(at, false)}
                        >
                          原音の前後を聞く
                        </button>
                        <button
                          className="primary"
                          disabled={!valid || !source}
                          onClick={() => onPlace(source!.id, item.key, at)}
                        >
                          この位置に配置
                        </button>
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </>
      ) : null}
    </section>
  );
}
