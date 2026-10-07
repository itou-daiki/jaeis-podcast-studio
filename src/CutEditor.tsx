import { memo, useEffect, useRef } from "react";
import { Play, X } from "lucide-react";
import { formatTime } from "./editing";
import type { Cut, Range, Track } from "./types";

// The original PCM, not the 50ms overview, shows quiet consonants at the join.
const BoundaryWaveform = memo(function BoundaryWaveform({
  tracks,
  time,
  duration,
  edge,
}: {
  tracks: Track[];
  time: number;
  duration: number;
  edge: "start" | "end";
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const el = canvas.current!;
    const draw = () => {
      const width = el.clientWidth,
        height = 72,
        dpr = window.devicePixelRatio || 1;
      el.width = width * dpr;
      el.height = height * dpr;
      const ctx = el.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      const from = time - 1.5,
        span = 3;
      const peaks = new Float32Array(Math.ceil(width));
      for (const track of tracks.filter((t) => !t.muted)) {
        const { buffer } = track;
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const values = buffer.getChannelData(ch);
          for (let x = 0; x < peaks.length; x++) {
            const start = Math.max(
              0,
              Math.floor(
                (from + (x / width) * span - track.offset) * buffer.sampleRate,
              ),
            );
            const end = Math.min(
              values.length,
              Math.ceil(
                (from + ((x + 1) / width) * span - track.offset) *
                  buffer.sampleRate,
              ),
            );
            for (let i = start; i < end; i++)
              peaks[x] = Math.max(peaks[x], Math.abs(values[i]));
          }
        }
      }
      const max = Math.max(0.01, ...peaks);
      ctx.fillStyle = "#177f79";
      for (let x = 0; x < peaks.length; x++) {
        if (
          from + (x / width) * span < 0 ||
          from + (x / width) * span > duration
        )
          continue;
        const h = Math.max(1, (peaks[x] / max) * 58);
        ctx.fillRect(x, (height - h) / 2, 1, h);
      }
      ctx.fillStyle = "#bd555521";
      ctx.fillRect(edge === "start" ? width / 2 : 0, 0, width / 2, height);
      ctx.strokeStyle = "#a24038";
      ctx.beginPath();
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2, height);
      ctx.stroke();
    };
    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(el);
    return () => observer.disconnect();
  }, [tracks, time, duration, edge]);
  return (
    <canvas className="boundary-waveform" ref={canvas} aria-hidden="true" />
  );
});

export function CutEditor({
  cut,
  draft,
  tracks,
  duration,
  existing,
  overlap,
  playing,
  onChange,
  onPreview,
  onStop,
  onApply,
  onCancel,
}: {
  cut: Cut;
  draft: Range;
  tracks: Track[];
  duration: number;
  existing: boolean;
  overlap: boolean;
  playing: boolean;
  onChange: (range: Range) => void;
  onPreview: (edited: boolean) => void;
  onStop: () => void;
  onApply: () => void;
  onCancel: () => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    root.current?.scrollIntoView({ block: "nearest" });
    root.current
      ?.querySelector<HTMLInputElement>("input")
      ?.focus({ preventScroll: true });
  }, [cut.id]);
  const valid =
    Number.isFinite(draft.start) &&
    Number.isFinite(draft.end) &&
    draft.start >= 0 &&
    draft.end <= duration &&
    draft.end - draft.start >= 0.03 - 1e-9;
  function move(edge: "start" | "end", value: number) {
    if (!Number.isFinite(value)) return;
    const boundary = Math.max(
      edge === "end" ? draft.start + 0.03 : 0,
      Math.min(edge === "start" ? draft.end - 0.03 : duration, value),
    );
    onChange({ ...draft, [edge]: Math.round(boundary * 1000) / 1000 });
  }
  return (
    <div ref={root} className="cut-editor" aria-label="カットの微調整">
      <div className="section-heading">
        <h3>{existing ? "カットの微調整" : "候補の微調整"}</h3>
        <button
          className="icon-button"
          aria-label="微調整を閉じる"
          onClick={onCancel}
        >
          <X size={16} />
        </button>
      </div>
      <p className="hint">
        中央の線が変更後の境界です。赤い側をカットします。波形は小さな声も見えるように拡大しています（音量は変わりません）。
      </p>
      <div className="cut-boundaries">
        {(["start", "end"] as const).map((edge) => (
          <div key={edge}>
            <label>
              {edge === "start" ? "カット開始" : "カット終了"}
              <input
                type="number"
                aria-label={`${edge === "start" ? "カット開始" : "カット終了"}の微調整（秒）`}
                value={draft[edge]}
                min={edge === "start" ? 0 : draft.start + 0.03}
                max={edge === "start" ? draft.end - 0.03 : duration}
                step={0.01}
                onChange={(e) => move(edge, e.target.valueAsNumber)}
              />
              秒
            </label>
            <BoundaryWaveform
              tracks={tracks}
              time={draft[edge]}
              duration={duration}
              edge={edge}
            />
            <div className="boundary-times">
              <span>{formatTime(Math.max(0, draft[edge] - 1.5))}</span>
              <strong>{formatTime(draft[edge], true)}</strong>
              <span>{formatTime(Math.min(duration, draft[edge] + 1.5))}</span>
            </div>
            <div className="boundary-nudges">
              <button
                aria-label={`${edge === "start" ? "開始" : "終了"}を0.05秒早める`}
                disabled={
                  draft[edge] <= (edge === "start" ? 0 : draft.start + 0.03)
                }
                onClick={() => move(edge, draft[edge] - 0.05)}
              >
                ← 0.05秒
              </button>
              <button
                aria-label={`${edge === "start" ? "開始" : "終了"}を0.05秒遅らせる`}
                disabled={
                  draft[edge] >=
                  (edge === "start" ? draft.end - 0.03 : duration)
                }
                onClick={() => move(edge, draft[edge] + 0.05)}
              >
                0.05秒 →
              </button>
            </div>
          </div>
        ))}
      </div>
      <p className="hint compact">
        {cut.reason} · カットする長さ{" "}
        {Math.max(0, draft.end - draft.start).toFixed(2)}
        秒。数値は0.01秒刻みで入力できます。変更は「反映する」まで保存しません。
      </p>
      {overlap ? (
        <p className="review-warning">
          別のカットと重なっています。重なった部分は一度だけカットします。
        </p>
      ) : null}
      <div className="cut-preview-actions">
        <button className="secondary" onClick={() => onPreview(false)}>
          <Play size={14} />
          元の前後を聞く
        </button>
        <button
          className="secondary"
          disabled={!valid}
          onClick={() => onPreview(true)}
        >
          <Play size={14} />
          変更後のつなぎ目を聞く
        </button>
        {playing ? (
          <button className="text-button" onClick={onStop}>
            試聴を停止
          </button>
        ) : null}
      </div>
      <div className="cut-commit-actions">
        <button className="primary" disabled={!valid} onClick={onApply}>
          反映する
        </button>
        <button className="text-button" onClick={onCancel}>
          変更をやめる
        </button>
      </div>
    </div>
  );
}
