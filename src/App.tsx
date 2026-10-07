import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AudioLines,
  Upload,
  Play,
  Pause,
  SkipBack,
  Scissors,
  Undo2,
  Redo2,
  Download,
  ShieldCheck,
  Plus,
  X,
  FileText,
  WandSparkles,
  Music2,
  Volume2,
  VolumeX,
  Search,
  Save,
  FolderOpen,
  ArrowRight,
  Check,
  CircleHelp,
  LoaderCircle,
} from "lucide-react";
import type { Candidate, Cue, Cut, MusicClip, Range, Track } from "./types";
import {
  buildPlacements,
  buildSegments,
  formatTime,
  normalizeCuts,
  outputToSource,
  sourceToOutput,
} from "./editing";
import {
  analyze,
  audioContext,
  colors,
  decode,
  download,
  encodeWav,
  MAX_PCM_BYTES,
  render,
  schedule,
  silenceCandidates,
} from "./media";
import {
  detectRetakes,
  editedCues,
  parseTranscript,
  toSrt,
} from "./transcript";
import { readProject, saveProject } from "./project";
import { Waveform } from "./Waveform";

const emptyRange = { start: 0, end: 0 };
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const safeName = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "jaeis-podcast";
const pcmBytes = (buffer: AudioBuffer) =>
  buffer.length * buffer.numberOfChannels * 4;

export default function App() {
  const [title, setTitle] = useState("新しいエピソード");
  const [tracks, setTracks] = useState<Track[]>([]),
    [music, setMusic] = useState<MusicClip[]>([]);
  const [history, setHistory] = useState<Cut[][]>([[]]),
    [historyIndex, setHistoryIndex] = useState(0);
  const cuts = history[historyIndex];
  const [selection, setSelection] = useState<Range>(emptyRange),
    [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1),
    [playing, setPlaying] = useState(false),
    [edited, setEdited] = useState(true);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"candidates" | "transcript" | "music">(
    "candidates",
  );
  const [cues, setCues] = useState<Cue[]>([]),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [dismissed, setDismissed] = useState<string[]>([]);
  const [query, setQuery] = useState(""),
    [model, setModel] = useState("onnx-community/whisper-base");
  const [cuePage, setCuePage] = useState(0);
  const [threshold, setThreshold] = useState(-45),
    [pauseLength, setPauseLength] = useState(2);
  const [exportOpen, setExportOpen] = useState(false),
    [format, setFormat] = useState<"wav" | "mp3">("mp3"),
    [normalize, setNormalize] = useState(true);
  const [help, setHelp] = useState(false),
    [asrRunning, setAsrRunning] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    subtitleInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    musicInput = useRef<HTMLInputElement>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]),
    raf = useRef(0),
    asr = useRef<Worker | null>(null),
    abortAsr = useRef<(() => void) | null>(null);
  const playheadRef = useRef(0);
  const duration = Math.max(
    0,
    ...tracks.map((t) => t.offset + t.buffer.duration),
  );
  const segments = useMemo(
    () => buildSegments(duration, cuts),
    [duration, cuts],
  );
  const plan = useMemo(
    () => buildPlacements(tracks, segments, music),
    [tracks, segments, music],
  );
  const removed = normalizeCuts(cuts, duration).reduce(
    (sum, c) => sum + c.end - c.start,
    0,
  );
  const remaining = candidates.filter(
    (c) => !dismissed.includes(c.id) && !cuts.some((k) => k.id === c.id),
  );
  const shownCues = cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) => `${cue.speaker ?? ""} ${cue.text}`.includes(query));
  const currentCuePage = Math.min(
    cuePage,
    Math.max(0, Math.ceil(shownCues.length / 100) - 1),
  );

  const stop = useCallback(() => {
    cancelAnimationFrame(raf.current);
    sources.current.forEach((source) => {
      try {
        source.stop();
      } catch {
        /* already ended */
      }
      source.disconnect();
    });
    sources.current = [];
    setPlaying(false);
  }, []);
  const seek = useCallback(
    (time: number) => {
      stop();
      playheadRef.current = time;
      setPlayhead(time);
    },
    [stop],
  );
  const select = useCallback(
    (range: Range) => {
      stop();
      setSelection(range);
    },
    [stop],
  );
  useEffect(
    () => () => {
      cancelAnimationFrame(raf.current);
      sources.current.forEach((s) => {
        try {
          s.stop();
        } catch {}
      });
      asr.current?.terminate();
    },
    [],
  );
  useEffect(() => {
    if (!tracks.length) return;
    const prevent = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", prevent);
    return () => window.removeEventListener("beforeunload", prevent);
  }, [tracks.length]);
  useEffect(() => {
    if (!exportOpen && !help) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
    const focusables = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]",
        ) ?? [],
      );
    focusables()[0]?.focus();
    const keydown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) {
        setHelp(false);
        setExportOpen(false);
      }
      if (e.key === "Tab") {
        const items = focusables(),
          first = items[0],
          last = items.at(-1);
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    document.addEventListener("keydown", keydown);
    return () => {
      document.removeEventListener("keydown", keydown);
      previous?.focus();
    };
  }, [exportOpen, help, busy]);

  const run = async (action: () => Promise<void>) => {
    stop();
    setError("");
    setNotice("");
    setBusy("準備しています…");
    try {
      await action();
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError"))
        setError(message(e));
    } finally {
      setBusy("");
    }
  };
  const changeCuts = (next: Cut[]) => {
    stop();
    setHistory((prev) =>
      [...prev.slice(0, historyIndex + 1), next].slice(-100),
    );
    setHistoryIndex(Math.min(99, historyIndex + 1));
  };
  const cutSelection = () => {
    if (selection.end - selection.start < 0.03) return;
    changeCuts([
      ...cuts,
      { ...selection, id: crypto.randomUUID(), reason: "手動カット" },
    ]);
    setNotice("カットを追加しました。元の音声は変更されません。");
  };
  const updateTrack = (id: string, patch: Partial<Track>) => {
    stop();
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
    setCandidates([]);
  };
  const updateMusic = (id: string, patch: Partial<MusicClip>) => {
    stop();
    setMusic((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  async function importFiles(files: File[]) {
    if (busy) return;
    await run(async () => {
      if (tracks.length + files.length > 8)
        throw new Error("声トラックは8本までです。");
      const next = [...tracks];
      let bytes =
        next.reduce((n, t) => n + pcmBytes(t.buffer), 0) +
        music.reduce((n, m) => n + pcmBytes(m.buffer), 0);
      for (const file of files) {
        if (
          next.some(
            (t) =>
              t.name === file.name &&
              t.size === file.size &&
              t.lastModified === file.lastModified,
          )
        )
          continue;
        const buffer = await decode(file, setBusy);
        bytes += pcmBytes(buffer);
        if (bytes > MAX_PCM_BYTES)
          throw new Error(
            "展開後の音声が850 MBを超えます。不要なトラックを外して再度読み込んでください。",
          );
        setBusy(`${file.name} の波形を作成しています…`);
        const analysis = await analyze(buffer);
        next.push({
          id: crypto.randomUUID(),
          name: file.name,
          size: file.size,
          lastModified: file.lastModified,
          buffer,
          ...analysis,
          gainDb: 0,
          offset: 0,
          muted: false,
          color: colors[next.length % colors.length],
        });
      }
      setTracks(next);
      setCandidates([]);
      setNotice(
        "読み込みました。分離音声は同じ開始時刻で並びます。混合音声との二重再生にご注意ください。",
      );
    });
  }

  async function play(mode = edited, range?: Range) {
    if (playing && !range) {
      stop();
      return;
    }
    try {
      stop();
      const ctx = audioContext();
      await ctx.resume();
      const selectedPlan = mode
        ? plan
        : buildPlacements(tracks, buildSegments(duration, []), []);
      const begin = range
        ? Math.max(0, range.start - 1.5)
        : playheadRef.current;
      const finish = range ? Math.min(duration, range.end + 2) : duration;
      let from = mode ? sourceToOutput(begin, selectedPlan.mapping) : begin;
      if (!range && (begin === 0 || from >= selectedPlan.duration - 0.05))
        from = 0;
      const until = range
        ? mode
          ? sourceToOutput(finish, selectedPlan.mapping)
          : finish
        : selectedPlan.duration;
      if (until <= from || !selectedPlan.placements.length) return;
      const start = ctx.currentTime + 0.06;
      sources.current = schedule(
        ctx,
        selectedPlan.placements,
        from,
        until,
        start,
      );
      setPlaying(true);
      const tick = () => {
        const time = from + Math.max(0, ctx.currentTime - start);
        if (time >= until) {
          stop();
          return;
        }
        const source = mode ? outputToSource(time, selectedPlan.mapping) : time;
        playheadRef.current = source;
        setPlayhead(source);
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    } catch (e) {
      setError(message(e));
      stop();
    }
  }

  async function demo() {
    await run(async () => {
      if (tracks.length) return;
      const buffer = audioContext().createBuffer(1, 44100 * 36, 44100),
        samples = buffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) {
        const t = i / 44100;
        const active =
          (t > 1 && t < 9) || (t > 12 && t < 22) || (t > 24 && t < 34);
        samples[i] = active
          ? 0.2 *
            Math.sin(2 * Math.PI * (180 + Math.floor(t / 10) * 55) * t) *
            (0.35 + 0.65 * Math.sin(t * 11) ** 2) *
            Math.min(1, (t % 1) * 10)
          : 0;
      }
      setTracks([
        {
          id: "demo",
          name: "操作デモ（合成音・実際の会話ではありません）",
          size: 0,
          lastModified: 0,
          buffer,
          ...(await analyze(buffer)),
          gainDb: 0,
          offset: 0,
          muted: false,
          color: colors[0],
        },
      ]);
      setTitle("操作デモ");
      setNotice("合成音のデモです。波形をドラッグしてカットや試聴を試せます。");
    });
  }

  function findCandidates() {
    stop();
    setDismissed([]);
    setCandidates(
      [
        ...silenceCandidates(tracks, duration, threshold, pauseLength),
        ...detectRetakes(cues),
      ]
        .filter((c) => c.start >= 0 && c.end <= duration)
        .sort((a, b) => a.start - b.start),
    );
    setTab("candidates");
    setNotice("候補を更新しました。この段階では音声は削除されません。");
  }
  async function transcribe() {
    await run(async () => {
      if (
        cues.length &&
        !window.confirm(
          "現在の文字起こしを新しい結果で置き換えます。必要なら先に字幕を保存してください。",
        )
      )
        return;
      const range =
        selection.end - selection.start > 0.1
          ? selection
          : { start: 0, end: duration };
      setBusy("文字起こし用の音声を準備しています…");
      const sourcePlan = buildPlacements(
        tracks,
        [{ ...range, outputStart: 0 }],
        [],
      );
      const mono = await render(
        sourcePlan.placements,
        range.end - range.start,
        16000,
        1,
      );
      const audio = mono.getChannelData(0).slice();
      setAsrRunning(true);
      await new Promise<void>((resolve, reject) => {
        const worker = new Worker(new URL("./asr.worker.ts", import.meta.url), {
          type: "module",
        });
        asr.current = worker;
        const finish = () => {
          worker.terminate();
          asr.current = null;
          abortAsr.current = null;
          setAsrRunning(false);
        };
        abortAsr.current = () => {
          finish();
          reject(new DOMException("中止しました", "AbortError"));
        };
        worker.onerror = (e) => {
          finish();
          reject(new Error(`文字起こしを開始できませんでした: ${e.message}`));
        };
        worker.onmessage = (event) => {
          const data = event.data;
          if (data.type === "progress") setBusy(data.message);
          if (data.type === "error") {
            finish();
            reject(
              new Error(
                `文字起こしに失敗しました: ${data.message}。Chrome / EdgeのPC版、または字幕ファイルの読み込みをお試しください。`,
              ),
            );
          }
          if (data.type === "complete") {
            setCues(data.cues);
            setTab("transcript");
            setNotice(
              "文字起こしが完了しました。人名・専門用語・無音部分の誤認識を確認してください。",
            );
            finish();
            resolve();
          }
        };
        worker.postMessage({ audio, model, offset: range.start }, [
          audio.buffer,
        ]);
      });
    });
  }

  function save() {
    download(
      saveProject({
        version: 1,
        title,
        cuts,
        cues,
        tracks: tracks.map(
          ({ name, size, lastModified, gainDb, offset, muted }) => ({
            name,
            size,
            lastModified,
            gainDb,
            offset,
            muted,
          }),
        ),
        music: music.map(({ name, buffer, role, at, gainDb }) => ({
          name,
          duration: buffer.duration,
          role,
          at,
          gainDb,
        })),
      }),
      `${safeName(title)}.studio.json`,
      "application/json",
    );
    setNotice(
      "編集内容を保存しました。再開時には、このファイルと同じ元音声を読み込んでください。",
    );
  }
  async function restore(file: File) {
    await run(async () => {
      const project = readProject(await file.text());
      if (
        project.tracks.length !== tracks.length ||
        project.tracks.some(
          (s) =>
            !tracks.some(
              (t) =>
                t.name === s.name &&
                t.size === s.size &&
                t.lastModified === s.lastModified,
            ),
        )
      )
        throw new Error(
          "先に保存時と同じ元音声を全て読み込んでください。ファイル名・サイズ・更新日時を照合します。",
        );
      if (
        project.music.length !== music.length ||
        project.music.some(
          (s) =>
            !music.some(
              (m) =>
                m.name === s.name &&
                Math.abs(m.buffer.duration - s.duration) < 0.01,
            ),
        )
      )
        throw new Error(
          "保存時と同じOP・ED・ジングルも先に読み込んでください。",
        );
      const restored = tracks.map((t) => ({
        ...t,
        ...project.tracks.find(
          (s) =>
            s.name === t.name &&
            s.size === t.size &&
            s.lastModified === t.lastModified,
        )!,
      }));
      const length = Math.max(
        0,
        ...restored.map((t) => t.offset + t.buffer.duration),
      );
      if (project.cuts.some((c) => c.end > length + 0.01))
        throw new Error("カット範囲が素材の長さを超えています。");
      const available = [...music];
      const restoredMusic = project.music.map((s) => {
        const index = available.findIndex(
          (m) =>
            m.name === s.name &&
            Math.abs(m.buffer.duration - s.duration) < 0.01,
        );
        if (index < 0)
          throw new Error(
            "音楽素材の数が一致しません。同じ音源を複数使う場合も、保存時の本数を読み込んでください。",
          );
        return { ...available.splice(index, 1)[0], ...s };
      });
      setTracks(restored);
      setMusic(restoredMusic);
      setCues(project.cues);
      setTitle(project.title);
      setHistory([project.cuts]);
      setHistoryIndex(0);
      setCandidates([]);
      setSelection(emptyRange);
      seek(0);
      setNotice("編集内容を復元しました。");
    });
  }

  async function exportAudio() {
    await run(async () => {
      setBusy("カットと音楽を反映しています…");
      const buffer = await render(plan.placements, plan.duration);
      // Reduce peaks only when necessary before PCM conversion; prevent wrap/clipping.
      let peak = 0;
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        const samples = buffer.getChannelData(ch);
        for (let i = 0; i < samples.length; i++)
          peak = Math.max(peak, Math.abs(samples[i]));
      }
      if (peak > 0.98)
        for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
          const samples = buffer.getChannelData(ch);
          for (let i = 0; i < samples.length; i++) samples[i] *= 0.98 / peak;
        }
      setBusy("WAVデータを作成しています…");
      let bytes = await encodeWav(buffer);
      if (format === "mp3" || normalize) {
        const { convertMedia } = await import("./conversion");
        bytes = await convertMedia(bytes, format, normalize, setBusy);
      }
      download(
        bytes,
        `${safeName(title)}.${format}`,
        format === "mp3" ? "audio/mpeg" : "audio/wav",
      );
      setExportOpen(false);
      setNotice(
        "音声を書き出しました。公開前に、つなぎ目と音楽の音量を必ず試聴してください。",
      );
    });
  }

  return (
    <>
      <header className="topbar">
        <a
          className="brand"
          href={import.meta.env.BASE_URL}
          onClick={(e) => e.preventDefault()}
          aria-label="JAEIS Podcast Studio"
        >
          <span className="brand-mark">
            <AudioLines size={25} />
          </span>
          <span>
            <strong>
              JAEIS <span>Podcast Studio</span>
            </strong>
            <small>情報科教員による、等身大の座談会。</small>
          </span>
        </a>
        <div className="top-actions">
          <span className="privacy">
            <ShieldCheck size={15} />
            音声は端末内で処理
          </span>
          <button
            className="icon-button"
            onClick={() => setHelp(true)}
            aria-label="使い方"
          >
            <CircleHelp size={19} />
          </button>
          <a
            href="https://github.com/itou-daiki/jaeis-podcast-studio"
            target="_blank"
            rel="noreferrer"
            className="version"
          >
            v0.1
          </a>
        </div>
      </header>
      <fieldset disabled={!!busy} className="app-fieldset">
        <main>
          <section className="project-heading">
            <div>
              <div className="eyebrow">JAEIS / EPISODE EDITOR</div>
              <input
                className="project-title"
                aria-label="エピソード名"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
              />
              <p>会話のよさを残して、聞きやすい一本に。</p>
            </div>
            <div className="project-actions">
              <button
                className="secondary"
                onClick={() => projectInput.current?.click()}
              >
                <FolderOpen size={16} />
                開く
              </button>
              <button
                className="secondary"
                onClick={save}
                disabled={!tracks.length}
              >
                <Save size={16} />
                編集を保存
              </button>
              <button
                className="primary"
                disabled={
                  !tracks.length ||
                  plan.duration <= 0 ||
                  !plan.placements.length
                }
                onClick={() => setExportOpen(true)}
              >
                <Download size={16} />
                音声を書き出す
              </button>
            </div>
          </section>
          <div className="workspace">
            <aside className="library">
              <div className="section-heading">
                <h2>収録素材</h2>
                <span>{tracks.length}/8</span>
              </div>
              <button
                className="import-button"
                onClick={() => input.current?.click()}
              >
                <Plus size={17} />
                音声・動画を追加
              </button>
              <p className="hint">
                MP4 / M4A / MP3 / WAV
                <br />
                混合音声・話者別音声に対応
              </p>
              <div className="source-list">
                {tracks.map((track, index) => (
                  <div className="source-item" key={track.id}>
                    <span
                      className="track-index"
                      style={{ color: track.color }}
                    >
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <div>
                      <strong title={track.name}>{track.name}</strong>
                      <small>
                        {formatTime(track.buffer.duration)} ·{" "}
                        {track.buffer.numberOfChannels === 2
                          ? "stereo"
                          : "mono"}
                      </small>
                    </div>
                    <button
                      aria-label={`${track.name} を外す`}
                      className="icon-button"
                      onClick={() => {
                        stop();
                        setTracks(tracks.filter((t) => t.id !== track.id));
                        setHistory([[]]);
                        setHistoryIndex(0);
                        setCandidates([]);
                        setCues([]);
                        setSelection(emptyRange);
                        seek(0);
                        setNotice(
                          "素材を外したため、カットと文字起こしをリセットしました。",
                        );
                      }}
                    >
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
              <div className="workflow-note">
                <span>編集の流れ</span>
                <ol>
                  <li>素材を読み込む</li>
                  <li>波形と文字で確認</li>
                  <li>不要な部分をカット</li>
                  <li>音楽を加えて書き出す</li>
                </ol>
              </div>
              <div className="local-note">
                <ShieldCheck size={19} />
                <p>
                  元ファイルは変更しません。
                  <br />
                  作業後は「編集を保存」を。
                  <br />
                  再読込すると作業は消えます。
                </p>
              </div>
            </aside>
            <section className="editor" aria-label="音声編集">
              <div className="editor-toolbar">
                <div className="section-heading">
                  <h2>タイムライン</h2>
                  <span>元音声の時刻</span>
                </div>
                <div className="toolbar-actions">
                  <button
                    className="icon-button"
                    aria-label="元に戻す"
                    disabled={historyIndex === 0}
                    onClick={() => {
                      stop();
                      setHistoryIndex((i) => i - 1);
                    }}
                  >
                    <Undo2 size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="やり直す"
                    disabled={historyIndex >= history.length - 1}
                    onClick={() => {
                      stop();
                      setHistoryIndex((i) => i + 1);
                    }}
                  >
                    <Redo2 size={17} />
                  </button>
                  <label className="zoom-label">
                    拡大
                    <select
                      aria-label="波形の拡大率"
                      value={zoom}
                      onChange={(e) => setZoom(Number(e.target.value))}
                    >
                      <option value={1}>全体</option>
                      <option value={2}>2倍</option>
                      <option value={4}>4倍</option>
                      <option value={8}>8倍</option>
                      <option value={16}>16倍</option>
                      <option value={32}>32倍</option>
                    </select>
                  </label>
                </div>
              </div>
              {!tracks.length ? (
                <div
                  className="dropzone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void importFiles([...e.dataTransfer.files]);
                  }}
                >
                  <div className="empty-wave" aria-hidden="true">
                    {Array.from({ length: 35 }, (_, i) => (
                      <i
                        key={i}
                        style={{
                          height: `${12 + Math.sin(i * 0.8) ** 2 * 46 + Math.sin(i * 0.3) ** 2 * 18}px`,
                        }}
                      />
                    ))}
                  </div>
                  <h2>収録した会話を、ここから。</h2>
                  <p>
                    ZoomのMP4や音声ファイルをドロップ。
                    <br />
                    動画から音声だけを取り出して編集できます。
                  </p>
                  <button
                    className="primary"
                    onClick={() => input.current?.click()}
                  >
                    <Upload size={17} />
                    素材を選ぶ
                  </button>
                  <button className="text-button" onClick={() => void demo()}>
                    操作デモを試す <ArrowRight size={15} />
                  </button>
                  <small>
                    PC版 Chrome / Edge 推奨 · 1ファイル350 MB / 45分まで
                  </small>
                </div>
              ) : (
                <>
                  <div className="timeline-scroll">
                    <div
                      className="timeline-inner"
                      style={{ width: `${zoom * 100}%` }}
                    >
                      <div className="time-ruler">
                        {Array.from({ length: 9 * zoom }, (_, i) => (
                          <span
                            key={i}
                            style={{ left: `${(i / (9 * zoom)) * 100}%` }}
                          >
                            {formatTime((i / (9 * zoom)) * duration)}
                          </span>
                        ))}
                      </div>
                      {tracks.map((track, index) => (
                        <div className="track-row" key={track.id}>
                          <div className="track-label">
                            <span style={{ color: track.color }}>●</span>
                            <strong>
                              {index + 1}. {track.name}
                            </strong>
                            <small>{formatTime(track.buffer.duration)}</small>
                          </div>
                          <Waveform
                            track={track}
                            duration={duration || 1}
                            zoom={zoom}
                            selection={selection}
                            cuts={cuts}
                            onSelect={select}
                            onSeek={seek}
                          />
                        </div>
                      ))}
                      <div
                        className="playhead"
                        style={{
                          left: `${(playhead / (duration || 1)) * 100}%`,
                        }}
                      >
                        <span />
                      </div>
                    </div>
                  </div>
                  <div className="selection-bar">
                    <Scissors size={16} />
                    <label>
                      開始{" "}
                      <input
                        aria-label="選択開始（秒）"
                        type="number"
                        min={0}
                        max={duration}
                        step={0.01}
                        value={Number(selection.start.toFixed(2))}
                        onChange={(e) => {
                          const start = Math.max(
                            0,
                            Math.min(duration, Number(e.target.value)),
                          );
                          select({
                            start,
                            end: Math.max(start, selection.end),
                          });
                        }}
                      />
                      <span>秒</span>
                    </label>
                    <span>—</span>
                    <label>
                      終了{" "}
                      <input
                        aria-label="選択終了（秒）"
                        type="number"
                        min={selection.start}
                        max={duration}
                        step={0.01}
                        value={Number(selection.end.toFixed(2))}
                        onChange={(e) =>
                          select({
                            ...selection,
                            end: Math.max(
                              selection.start,
                              Math.min(duration, Number(e.target.value)),
                            ),
                          })
                        }
                      />
                      <span>秒</span>
                    </label>
                    <button
                      className="cut-button"
                      disabled={selection.end - selection.start < 0.03}
                      onClick={cutSelection}
                    >
                      選択範囲をカット
                    </button>
                    <button
                      className="icon-button"
                      onClick={() => select(emptyRange)}
                      aria-label="選択を解除"
                    >
                      <X size={15} />
                    </button>
                  </div>
                  <div className="mix-section">
                    <div className="section-heading">
                      <h3>声のバランス</h3>
                      <span>別々に録った音声は開始位置を調整</span>
                    </div>
                    {tracks.map((t) => (
                      <div className="mixer" key={t.id}>
                        <button
                          className="icon-button"
                          aria-label={`${t.name} ${t.muted ? "ミュート解除" : "ミュート"}`}
                          onClick={() => updateTrack(t.id, { muted: !t.muted })}
                        >
                          {t.muted ? (
                            <VolumeX size={17} />
                          ) : (
                            <Volume2 size={17} />
                          )}
                        </button>
                        <span title={t.name}>{t.name}</span>
                        <input
                          aria-label={`${t.name} 音量`}
                          type="range"
                          min={-24}
                          max={12}
                          step={0.5}
                          value={t.gainDb}
                          onChange={(e) =>
                            updateTrack(t.id, {
                              gainDb: Number(e.target.value),
                            })
                          }
                        />
                        <small>
                          {t.gainDb > 0 ? "+" : ""}
                          {t.gainDb} dB
                        </small>
                        <label>
                          開始{" "}
                          <input
                            aria-label={`${t.name} 開始位置（秒）`}
                            type="number"
                            step={0.01}
                            min={-3600}
                            max={3600}
                            value={t.offset}
                            onChange={(e) => {
                              setHistory([[]]);
                              setHistoryIndex(0);
                              setCues([]);
                              updateTrack(t.id, {
                                offset: Math.max(
                                  -3600,
                                  Math.min(3600, Number(e.target.value)),
                                ),
                              });
                              setNotice(
                                "同期位置を変えたため、時刻に依存するカットと字幕をリセットしました。",
                              );
                            }}
                          />
                          秒
                        </label>
                      </div>
                    ))}
                  </div>
                </>
              )}
              <div className="transport">
                <button
                  className="transport-back"
                  aria-label="先頭へ"
                  onClick={() => seek(0)}
                  disabled={!tracks.length}
                >
                  <SkipBack size={19} />
                </button>
                <button
                  className="play-button"
                  aria-label={playing ? "停止" : "再生"}
                  onClick={() => void play()}
                  disabled={!tracks.length}
                >
                  {playing ? (
                    <Pause size={21} fill="currentColor" />
                  ) : (
                    <Play size={21} fill="currentColor" />
                  )}
                </button>
                <div className="time-display">
                  {formatTime(playhead)}
                  <span>/ {formatTime(duration)}</span>
                </div>
                <label className="preview-mode">
                  <input
                    type="checkbox"
                    checked={edited}
                    onChange={(e) => {
                      stop();
                      setEdited(e.target.checked);
                    }}
                  />
                  編集後を試聴
                </label>
                <span className="output-time">
                  完成予定 <strong>{formatTime(plan.duration)}</strong>
                </span>
              </div>
              <div className="edit-log">
                <div className="section-heading">
                  <h3>
                    カット履歴 <span>{cuts.length}</span>
                  </h3>
                  <small>短縮 {formatTime(removed)} · 元に戻せます</small>
                </div>
                {cuts.length ? (
                  cuts.map((c) => (
                    <div className="log-row" key={c.id}>
                      <button
                        className="text-button"
                        onClick={() => {
                          select(c);
                          seek(c.start);
                        }}
                      >
                        {formatTime(c.start, true)}–{formatTime(c.end, true)}
                      </button>
                      <span>{c.reason}</span>
                      <button
                        className="icon-button"
                        onClick={() =>
                          changeCuts(cuts.filter((k) => k.id !== c.id))
                        }
                        aria-label={`${formatTime(c.start)} のカットを取り消す`}
                      >
                        <Undo2 size={14} />
                      </button>
                    </div>
                  ))
                ) : (
                  <p className="hint">
                    波形をドラッグして範囲を選ぶか、右の候補から確認します。
                  </p>
                )}
              </div>
            </section>
            <aside className="inspector">
              <div className="tabs" role="tablist" aria-label="編集支援">
                <button
                  role="tab"
                  aria-selected={tab === "candidates"}
                  onClick={() => setTab("candidates")}
                >
                  <WandSparkles size={16} />
                  候補
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "transcript"}
                  onClick={() => setTab("transcript")}
                >
                  <FileText size={16} />
                  文字
                </button>
                <button
                  role="tab"
                  aria-selected={tab === "music"}
                  onClick={() => setTab("music")}
                >
                  <Music2 size={16} />
                  音楽
                </button>
              </div>
              {tab === "candidates" ? (
                <div className="inspector-content">
                  <div className="section-heading">
                    <h2>カット候補を確認</h2>
                    <span>{remaining.length}件</span>
                  </div>
                  <p className="hint">
                    無音や言い直しを見つけます。
                    <br />
                    採用するまで、音声は残ります。
                  </p>
                  <div className="detection-settings">
                    <label>
                      静かな区間{" "}
                      <select
                        aria-label="無音検出のしきい値"
                        value={threshold}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                      >
                        <option value={-50}>−50 dB（慎重）</option>
                        <option value={-45}>−45 dB（標準）</option>
                        <option value={-35}>−35 dB</option>
                      </select>
                    </label>
                    <label>
                      長さ{" "}
                      <select
                        aria-label="無音検出の長さ"
                        value={pauseLength}
                        onChange={(e) => setPauseLength(Number(e.target.value))}
                      >
                        <option value={2}>2秒以上</option>
                        <option value={3}>3秒以上</option>
                        <option value={5}>5秒以上</option>
                      </select>
                    </label>
                  </div>
                  <button
                    className="primary full"
                    disabled={!tracks.length}
                    onClick={findCandidates}
                  >
                    <WandSparkles size={16} />
                    候補を探す
                  </button>
                  <p className="hint compact">
                    リテイク検出には文字起こしが必要です。原稿との違いだけでは判定しません。
                  </p>
                  <div className="candidate-list">
                    {remaining.length ? (
                      remaining.map((c) => (
                        <article className="candidate" key={c.id}>
                          <div>
                            <span className={`candidate-kind ${c.kind}`}>
                              {c.kind === "silence"
                                ? "静かな区間"
                                : c.kind === "retake"
                                  ? "言い直し"
                                  : "似た発言"}
                            </span>
                            <small>
                              {formatTime(c.start)}–{formatTime(c.end)}
                            </small>
                          </div>
                          <p>{c.detail}</p>
                          <div className="candidate-actions">
                            <button
                              onClick={() => {
                                select(c);
                                void play(false, c);
                              }}
                            >
                              <Play size={13} />
                              元音声
                            </button>
                            <button
                              onClick={() => {
                                select(c);
                                seek(c.start);
                              }}
                            >
                              <Scissors size={13} />
                              範囲
                            </button>
                            <button
                              onClick={() => {
                                changeCuts([
                                  ...cuts,
                                  {
                                    id: c.id,
                                    start: c.start,
                                    end: c.end,
                                    reason: c.reason,
                                  },
                                ]);
                                setNotice(
                                  "カットを採用しました。選択範囲の「つなぎ目を試聴」で確認できます。",
                                );
                                select(c);
                              }}
                            >
                              <Check size={13} />
                              採用
                            </button>
                            <button
                              aria-label="この候補を残す"
                              onClick={() =>
                                setDismissed((prev) => [...prev, c.id])
                              }
                            >
                              <X size={13} />
                            </button>
                          </div>
                        </article>
                      ))
                    ) : (
                      <div className="quiet-state">
                        <AudioLines size={32} />
                        <p>
                          まずは、会話をそのまま。
                          <br />
                          必要なところだけ整えましょう。
                        </p>
                      </div>
                    )}
                  </div>
                  {selection.end > selection.start ? (
                    <button
                      className="secondary full"
                      onClick={() => void play(true, selection)}
                    >
                      <Play size={14} />
                      つなぎ目を試聴
                    </button>
                  ) : null}
                </div>
              ) : null}
              {tab === "transcript" ? (
                <div className="inspector-content">
                  <div className="section-heading">
                    <h2>文字起こし</h2>
                    <span>{cues.length}区間</span>
                  </div>
                  <div className="asr-box">
                    <label>
                      日本語モデル
                      <select
                        aria-label="文字起こしモデル"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                      >
                        <option value="onnx-community/whisper-tiny">
                          Whisper Tiny · 約41 MB
                        </option>
                        <option value="onnx-community/whisper-base">
                          Whisper Base · 約77 MB
                        </option>
                        <option value="onnx-community/whisper-small">
                          Whisper Small · 約249 MB
                        </option>
                      </select>
                    </label>
                    <p className="hint">
                      初回はモデルを外部から取得します（数十〜数百MB）。音声は送信しません。PCの性能により収録時間以上かかる場合があります。
                    </p>
                    <button
                      className="primary full"
                      onClick={() => void transcribe()}
                      disabled={!tracks.some((t) => !t.muted) || duration <= 0}
                    >
                      <WandSparkles size={15} />
                      {selection.end > selection.start
                        ? "選択範囲を文字起こし"
                        : "日本語を文字起こし"}
                    </button>
                    <p className="hint compact">
                      まず短い範囲でお試しください。選択範囲の処理も既存の字幕を置き換えます。
                    </p>
                  </div>
                  <button
                    className="secondary full"
                    onClick={() => subtitleInput.current?.click()}
                  >
                    <Upload size={15} />
                    Zoom字幕などを読み込む
                  </button>
                  <p className="hint compact">
                    VTT / SRT / Whisper JSON · 元音声と同じ時刻のもの
                  </p>
                  <label className="search-box">
                    <Search size={15} />
                    <input
                      aria-label="文字起こしを検索"
                      placeholder="発言を検索…"
                      value={query}
                      onChange={(e) => {
                        setQuery(e.target.value);
                        setCuePage(0);
                      }}
                    />
                  </label>
                  <div className="transcript-list">
                    {shownCues
                      .slice(currentCuePage * 100, (currentCuePage + 1) * 100)
                      .map(({ cue, index }) => (
                        <div className="cue" key={index}>
                          <button
                            className="cue-time"
                            onClick={() => {
                              select(cue);
                              seek(cue.start);
                              void play(false, cue);
                            }}
                          >
                            <Play size={11} />
                            {formatTime(cue.start)}
                          </button>
                          {cue.speaker ? <small>{cue.speaker}</small> : null}
                          <textarea
                            aria-label={`${formatTime(cue.start)} の発言`}
                            value={cue.text}
                            onChange={(e) =>
                              setCues((prev) =>
                                prev.map((c, i) =>
                                  i === index
                                    ? { ...c, text: e.target.value }
                                    : c,
                                ),
                              )
                            }
                          />
                        </div>
                      ))}
                  </div>
                  {shownCues.length > 100 ? (
                    <div className="section-heading pagination">
                      <button
                        className="text-button"
                        disabled={currentCuePage === 0}
                        onClick={() => setCuePage(currentCuePage - 1)}
                      >
                        前の100区間
                      </button>
                      <span>
                        {currentCuePage + 1} /{" "}
                        {Math.ceil(shownCues.length / 100)}
                      </span>
                      <button
                        className="text-button"
                        disabled={
                          (currentCuePage + 1) * 100 >= shownCues.length
                        }
                        onClick={() => setCuePage(currentCuePage + 1)}
                      >
                        次の100区間
                      </button>
                    </div>
                  ) : null}
                  {cues.length ? (
                    <div className="subtitle-actions">
                      <button
                        className="text-button"
                        onClick={() =>
                          download(
                            toSrt(cues),
                            `${safeName(title)}-元時刻.srt`,
                            "text/plain",
                          )
                        }
                      >
                        元時刻の字幕を保存
                      </button>
                      <button
                        className="text-button"
                        onClick={() => {
                          download(
                            toSrt(editedCues(cues, plan.mapping)),
                            `${safeName(title)}-編集後.srt`,
                            "text/plain",
                          );
                          setNotice(
                            "編集後の字幕を保存しました。カットをまたぐ発言は不正確になるため省略しています。",
                          );
                        }}
                      >
                        編集後の字幕を保存
                      </button>
                    </div>
                  ) : null}
                  <p className="hint">
                    誤認識を修正してから候補を探してください。話者の自動識別は行いません。
                  </p>
                </div>
              ) : null}
              {tab === "music" ? (
                <div className="inspector-content">
                  <div className="section-heading">
                    <h2>OP・ED・ジングル</h2>
                  </div>
                  <p className="hint">
                    使用許可のある音源を追加します。
                    <br />
                    OPとEDは前後に、ジングルは元音声の指定時刻に挿入します。
                  </p>
                  <button
                    className="secondary full"
                    onClick={() => musicInput.current?.click()}
                  >
                    <Plus size={16} />
                    音楽を追加
                  </button>
                  {music.map((m) => (
                    <article className="music-card" key={m.id}>
                      <div className="section-heading">
                        <strong title={m.name}>{m.name}</strong>
                        <button
                          aria-label={`${m.name} を外す`}
                          className="icon-button"
                          onClick={() => {
                            stop();
                            setMusic(music.filter((clip) => clip.id !== m.id));
                          }}
                        >
                          <X size={15} />
                        </button>
                      </div>
                      <label>
                        用途
                        <select
                          value={m.role}
                          onChange={(e) =>
                            updateMusic(m.id, {
                              role: e.target.value as MusicClip["role"],
                            })
                          }
                        >
                          <option value="opening">オープニング</option>
                          <option value="ending">エンディング</option>
                          <option value="jingle">ジングル</option>
                        </select>
                      </label>
                      {m.role === "jingle" ? (
                        <label>
                          挿入位置（元音声・秒）
                          <input
                            type="number"
                            min={0}
                            max={duration}
                            step={0.1}
                            value={m.at}
                            onChange={(e) =>
                              updateMusic(m.id, {
                                at: Math.max(
                                  0,
                                  Math.min(duration, Number(e.target.value)),
                                ),
                              })
                            }
                          />
                        </label>
                      ) : null}
                      <label>
                        音量 {m.gainDb} dB
                        <input
                          type="range"
                          min={-36}
                          max={0}
                          step={1}
                          value={m.gainDb}
                          onChange={(e) =>
                            updateMusic(m.id, {
                              gainDb: Number(e.target.value),
                            })
                          }
                        />
                      </label>
                      <small>
                        {formatTime(m.buffer.duration)} · 前後を短くフェード
                      </small>
                    </article>
                  ))}
                  <div className="info-note">
                    この版では音楽を会話に重ねず、間に挿入します。会話を邪魔しない音量を試聴して調整してください。
                  </div>
                </div>
              ) : null}
            </aside>
          </div>
          <footer>
            <span>JAEIS Podcast Studio</span>
            <span>原稿に縛られず、対話を生かす編集。</span>
            <button className="text-button" onClick={() => setHelp(true)}>
              使い方・制限事項
            </button>
            <a
              href={`${import.meta.env.BASE_URL}licenses/`}
              target="_blank"
              rel="noreferrer"
            >
              ライセンス
            </a>
          </footer>
        </main>
        <input
          ref={input}
          className="hidden"
          aria-label="収録ファイル"
          type="file"
          multiple
          accept="audio/*,video/mp4,.m4a,.mp4,.wav,.mp3,.webm"
          onChange={(e) => {
            if (e.target.files) void importFiles([...e.target.files]);
            e.target.value = "";
          }}
        />
        <input
          ref={subtitleInput}
          className="hidden"
          aria-label="字幕ファイル"
          type="file"
          accept=".vtt,.srt,.json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f)
              void run(async () => {
                if (f.size > 10000000) throw new Error("字幕は10 MBまでです。");
                const parsed = parseTranscript(await f.text());
                if (duration && parsed.some((c) => c.end > duration + 2))
                  throw new Error(
                    "字幕の時刻が収録時間を超えています。対応する収録を確認してください。",
                  );
                setCues(parsed);
                setNotice("字幕を読み込みました。");
              });
            e.target.value = "";
          }}
        />
        <input
          ref={projectInput}
          className="hidden"
          aria-label="プロジェクトファイル"
          type="file"
          accept=".json"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void restore(f);
            e.target.value = "";
          }}
        />
        <input
          ref={musicInput}
          className="hidden"
          aria-label="音楽ファイル"
          type="file"
          accept="audio/*,.mp3,.wav,.m4a"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f)
              void run(async () => {
                if (music.length >= 20) throw new Error("音楽は20本までです。");
                const buffer = await decode(f, setBusy);
                if (buffer.duration > 180)
                  throw new Error(
                    "OP・ED・ジングルは3分以内の音源を選んでください。",
                  );
                if (
                  tracks.reduce((s, t) => s + pcmBytes(t.buffer), 0) +
                    music.reduce((s, m) => s + pcmBytes(m.buffer), 0) +
                    pcmBytes(buffer) >
                  MAX_PCM_BYTES
                )
                  throw new Error("素材の合計サイズが大きすぎます。");
                setMusic((prev) => [
                  ...prev,
                  {
                    id: crypto.randomUUID(),
                    name: f.name,
                    buffer,
                    role: prev.some((m) => m.role === "opening")
                      ? "ending"
                      : "opening",
                    at: playheadRef.current,
                    gainDb: -12,
                  },
                ]);
              });
            e.target.value = "";
          }}
        />
      </fieldset>
      {error ? (
        <div className="toast error" role="alert">
          <span>{error}</span>
          <button
            className="icon-button"
            aria-label="エラーを閉じる"
            onClick={() => setError("")}
          >
            <X size={17} />
          </button>
        </div>
      ) : notice ? (
        <div className="toast" role="status">
          <Check size={17} />
          <span>{notice}</span>
          <button
            className="icon-button"
            aria-label="通知を閉じる"
            onClick={() => setNotice("")}
          >
            <X size={17} />
          </button>
        </div>
      ) : null}
      {busy ? (
        <div className="busy-banner" role="status">
          <LoaderCircle className="spin" size={20} />
          <span>{busy}</span>
          {asrRunning ? (
            <button onClick={() => abortAsr.current?.()}>
              文字起こしを中止
            </button>
          ) : null}
        </div>
      ) : null}
      {exportOpen ? (
        <div className="modal-backdrop">
          <section
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="export-title"
          >
            <div className="section-heading">
              <h2 id="export-title">音声を書き出す</h2>
              <button
                className="icon-button"
                aria-label="書き出しを閉じる"
                disabled={!!busy}
                onClick={() => setExportOpen(false)}
              >
                <X />
              </button>
            </div>
            <p>
              完成予定 <strong>{formatTime(plan.duration)}</strong> · カット{" "}
              {cuts.length}件 · 音楽 {music.length}本
            </p>
            <fieldset disabled={!!busy}>
              <label>
                ファイル形式
                <select
                  value={format}
                  onChange={(e) => setFormat(e.target.value as "wav" | "mp3")}
                >
                  <option value="mp3">MP3 · 192 kbps / 配布用</option>
                  <option value="wav">
                    WAV · 44.1 kHz / 16 bit / 再編集用
                  </option>
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={normalize}
                  onChange={(e) => setNormalize(e.target.checked)}
                />
                番組全体の音量をそろえる（−16 LUFS目標）
              </label>
              <p className="hint">
                音量調整は書き出し時に行います。プレビューには反映されません。単一パス処理のため目標値と差が出る場合があります。元音声は変更されません。
              </p>
              <button
                className="primary full"
                onClick={() => void exportAudio()}
              >
                <Download size={17} />
                {busy ? "処理中…" : "この設定で書き出す"}
              </button>
            </fieldset>
          </section>
        </div>
      ) : null}
      {help ? (
        <div className="modal-backdrop">
          <section
            className="modal help-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="help-title"
          >
            <div className="section-heading">
              <h2 id="help-title">会話を残す、編集の手順</h2>
              <button
                className="icon-button"
                aria-label="使い方を閉じる"
                onClick={() => setHelp(false)}
              >
                <X />
              </button>
            </div>
            <ol>
              <li>
                ZoomのMP4または音声を追加。混合音声か話者別音声のどちらかを使い、二重に重ねないでください。
              </li>
              <li>
                波形をドラッグして選択。拡大してつなぎ目を確認し、開始・終了の秒数を微調整できます。
              </li>
              <li>
                「文字」でブラウザ内の文字起こし、またはZoomのVTTを読み込み。「候補」で不要部分を探します。
              </li>
              <li>
                候補は必ず試聴して採用。誤認識や似た表現だけで会話を自動削除しません。
              </li>
              <li>
                音楽を追加し、音量を調整。音声と編集内容の両方を保存してください。
              </li>
            </ol>
            <h3>保存とプライバシー</h3>
            <p>
              音声・字幕はこの端末で処理します。モデル取得時のみHugging
              Face等へ接続します。アプリへのアクセスはGitHub
              Pagesに記録され得ます。モデルはブラウザにキャッシュされる場合があります。
            </p>
            <p>
              編集ファイルに音声本体は含まれません。再開時は同じ素材を先に読み込みます。ブラウザを閉じると未保存の編集は失われます。
            </p>
            <h3>現在の制限</h3>
            <p>
              PCのChrome /
              Edgeを推奨。長時間・多トラックはメモリを多く使います。話者の自動識別、音楽の重ね合わせ、自動要約は未対応です。SmallはBaseより重く、精度が必ず上がるとは限りません。専門用語や人名は確認してください。
            </p>
            <p>
              <a
                href="https://huggingface.co/onnx-community/whisper-base"
                target="_blank"
                rel="noreferrer"
              >
                Whisperモデル
              </a>{" "}
              ·{" "}
              <a
                href="https://huggingface.co/docs/transformers.js"
                target="_blank"
                rel="noreferrer"
              >
                Transformers.js
              </a>{" "}
              ·{" "}
              <a
                href="https://ffmpegwasm.netlify.app/"
                target="_blank"
                rel="noreferrer"
              >
                FFmpeg.wasm
              </a>
            </p>
          </section>
        </div>
      ) : null}
    </>
  );
}
