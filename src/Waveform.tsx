import { memo, useEffect, useRef } from "react";
import type { Cut, Range, Track } from "./types";
import { formatTime } from "./editing";

type Props = {
  track: Track;
  duration: number;
  zoom: number;
  selection: Range;
  cuts: Cut[];
  onSelect: (range: Range) => void;
  onSeek: (time: number) => void;
  // Outside the cut step the waveform only moves the playhead.
  selectable?: boolean;
};
export const Waveform = memo(function Waveform({
  track,
  duration,
  zoom,
  selection,
  cuts,
  onSelect,
  onSeek,
  selectable = true,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null),
    start = useRef<number | null>(null),
    container = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = canvas.current!,
      parent = container.current!,
      viewport = parent.closest<HTMLElement>(".timeline-scroll")!;
    let frame = 0;
    const draw = () => {
      // Only allocate the visible part. A 32x canvas exceeded Chromium's
      // dimension limit on real recordings and made the waveform disappear.
      const fullWidth = parent.clientWidth,
        left = Math.floor(
          Math.max(
            0,
            Math.min(viewport.scrollLeft, fullWidth - viewport.clientWidth),
          ),
        ),
        width = Math.min(viewport.clientWidth + 2, fullWidth - left),
        height = 94,
        dpr = Math.min(2, window.devicePixelRatio || 1);
      if (width <= 0) return;
      el.style.width = `${width}px`;
      el.style.left = `${left}px`;
      el.width = width * dpr;
      el.height = height * dpr;
      const ctx = el.getContext("2d")!;
      ctx.scale(dpr, dpr);
      ctx.clearRect(0, 0, width, height);
      ctx.strokeStyle = "#dce2eb";
      ctx.beginPath();
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();
      ctx.fillStyle = track.muted ? "#a6afbc" : track.color;
      const gain = 10 ** (track.gainDb / 20);
      for (let x = 0; x < width; x += 2) {
        const from =
            (((left + x) / fullWidth) * duration - track.offset) / 0.05,
          to = (((left + x + 2) / fullWidth) * duration - track.offset) / 0.05;
        let peak = 0;
        for (
          let i = Math.max(0, Math.floor(from));
          i < Math.min(track.peaks.length, Math.ceil(to));
          i++
        )
          peak = Math.max(peak, track.peaks[i]);
        const h = Math.min(0.98, peak * gain) * height * 0.85;
        if (h > 0) ctx.fillRect(x, (height - h) / 2, 1.5, Math.max(1, h));
      }
    };
    const requestDraw = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(draw);
    };
    draw();
    const observer = new ResizeObserver(requestDraw);
    observer.observe(parent);
    observer.observe(viewport);
    viewport.addEventListener("scroll", requestDraw, { passive: true });
    return () => {
      observer.disconnect();
      viewport.removeEventListener("scroll", requestDraw);
      cancelAnimationFrame(frame);
    };
  }, [track, duration, zoom]);
  const at = (event: React.PointerEvent) =>
    Math.max(
      0,
      Math.min(
        duration,
        ((event.clientX - event.currentTarget.getBoundingClientRect().left) /
          event.currentTarget.clientWidth) *
          duration,
      ),
    );
  return (
    <div
      ref={container}
      className="waveform"
      role="group"
      aria-label={
        selectable
          ? `${track.name} の波形。ドラッグで選択。キーボードでは下の開始・終了欄を使用。`
          : `${track.name} の波形。クリックで再生位置を移動。`
      }
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        start.current = at(e);
        e.currentTarget.setPointerCapture(e.pointerId);
        onSeek(start.current);
      }}
      onPointerMove={(e) => {
        if (start.current !== null && selectable)
          onSelect({
            start: Math.min(start.current, at(e)),
            end: Math.max(start.current, at(e)),
          });
      }}
      onPointerUp={(e) => {
        if (
          selectable &&
          start.current !== null &&
          Math.abs(at(e) - start.current) < 0.08
        )
          onSelect({ start: at(e), end: at(e) });
        start.current = null;
      }}
      onPointerCancel={() => {
        start.current = null;
      }}
    >
      <canvas ref={canvas} aria-hidden="true" />
      {cuts.map((c) => (
        <div
          key={c.id}
          title={`カット: ${formatTime(c.start)}–${formatTime(c.end)}`}
          className="cut-overlay"
          style={{
            left: `${(c.start / duration) * 100}%`,
            width: `${((c.end - c.start) / duration) * 100}%`,
          }}
        />
      ))}
      {selection.end > selection.start ? (
        <div
          className="selection-overlay"
          style={{
            left: `${(selection.start / duration) * 100}%`,
            width: `${((selection.end - selection.start) / duration) * 100}%`,
          }}
        />
      ) : null}
    </div>
  );
});
