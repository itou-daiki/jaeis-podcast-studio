import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
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
  Minus,
  X,
  FileText,
  WandSparkles,
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
  applyCutRange,
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
import {
  missingSources,
  readProject,
  saveProject,
  type Project,
  type SavedScript,
} from "./project";
import { clearSpeakerHint, parseScript } from "./speakers";
import { scriptJob } from "./script-jobs";
import { CueSpeaker, ScriptPanel } from "./ScriptPanel";
import { Waveform } from "./Waveform";
import { CutEditor } from "./CutEditor";
import { VoicePanel } from "./VoicePanel";
import { JinglePanel } from "./JinglePanel";
import { MusicLibrary } from "./MusicLibrary";
import { loadBuiltInMusic, restoreMusic } from "./music-library";
import { placeScriptJingle } from "./jingles";
import { hasVoiceEffects, originalVoice, type VoiceSettings } from "./voice";
import { DeliveryPanel, NextStep, WorkflowNav, type Step } from "./Workflow";
import { renderExport } from "./export-audio";

const draftKey = "jaeis-podcast-studio:draft:v1";
function loadDraft(): { project?: Project; error?: string } {
  try {
    const text = localStorage.getItem(draftKey);
    return text ? { project: readProject(text) } : {};
  } catch {
    return {
      error:
        "前回の自動保存を読み出せません。保存済みの編集ファイルから再開できます。",
    };
  }
}

const emptyRange = { start: 0, end: 0 };
const pausePresets = [
  { id: "relaxed", name: "ゆったり", minimum: 2.5, keep: 1.2 },
  { id: "natural", name: "自然", minimum: 2, keep: 0.8 },
  { id: "brisk", name: "テンポよく", minimum: 1.5, keep: 0.5 },
];
const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);
const safeName = (name: string) =>
  name.replace(/[\\/:*?"<>|]/g, "_").slice(0, 100) || "jaeis-podcast";
const pcmBytes = (buffer: AudioBuffer) =>
  buffer.length * buffer.numberOfChannels * 4;
const trackBytes = (track: Track) =>
  pcmBytes(track.buffer) + (track.processed ? pcmBytes(track.processed) : 0);
const rawTracks = (tracks: Track[]) =>
  tracks.map((t) => ({ ...t, processed: undefined }));

export default function App() {
  const [title, setTitle] = useState("新しいエピソード");
  const [step, setStep] = useState<Step>("source");
  const [initialDraft, setInitialDraft] = useState(loadDraft);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const restoreAttempt = useRef<Project | null>(null);
  const voiceAbort = useRef<AbortController | null>(null);
  const [voiceRunning, setVoiceRunning] = useState(false);
  const voicePreview = useRef<{ id: string; range: Range } | null>(null);
  const [saveStatus, setSaveStatus] = useState("");
  const [review, setReview] = useState<{
    signature: string;
    checks: boolean[];
  }>({ signature: "", checks: [] });
  const [tracks, setTracks] = useState<Track[]>([]),
    [music, setMusic] = useState<MusicClip[]>([]);
  const [jingleSource, setJingleSource] = useState<MusicClip>();
  const [musicPreview, setMusicPreview] = useState<string>();
  const [history, setHistory] = useState<Cut[][]>([[]]),
    [historyIndex, setHistoryIndex] = useState(0);
  const cuts = history[historyIndex];
  const [editingCutId, setEditingCutId] = useState<string | null>(null);
  const [selection, setSelection] = useState<Range>(emptyRange),
    [playhead, setPlayhead] = useState(0);
  const [zoom, setZoom] = useState(1),
    [playing, setPlaying] = useState(false),
    [edited, setEdited] = useState(true);
  const [busy, setBusy] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [tab, setTab] = useState<"candidates" | "transcript">("candidates");
  const [cues, setCues] = useState<Cue[]>([]),
    [candidates, setCandidates] = useState<Candidate[]>([]),
    [dismissed, setDismissed] = useState<string[]>([]);
  const [query, setQuery] = useState(""),
    [model, setModel] = useState("onnx-community/whisper-base");
  const [cuePage, setCuePage] = useState(0);
  const [script, setScript] = useState<SavedScript>();
  const parsedScript = useMemo(
    () => parseScript(script?.text ?? ""),
    [script?.text],
  );
  const speakerNames = useMemo(
    () => [
      ...new Set([
        ...parsedScript.speakers,
        ...cues.flatMap((c) => (c.speaker ? [c.speaker] : [])),
      ]),
    ],
    [parsedScript, cues],
  );
  const [threshold, setThreshold] = useState<number | null>(null);
  const [pauseLength, setPauseLength] = useState(2),
    [keepSeconds, setKeepSeconds] = useState(0.8);
  const pausePreset =
    pausePresets.find(
      (p) => p.minimum === pauseLength && p.keep === keepSeconds,
    )?.id ?? "custom";
  const [format, setFormat] = useState<"wav" | "mp3">("mp3"),
    [normalize, setNormalize] = useState(true);
  const [help, setHelp] = useState(false),
    [asrRunning, setAsrRunning] = useState(false);
  const musicImportRole = useRef<"jingle" | undefined>(undefined);
  const input = useRef<HTMLInputElement>(null),
    subtitleInput = useRef<HTMLInputElement>(null),
    projectInput = useRef<HTMLInputElement>(null),
    musicInput = useRef<HTMLInputElement>(null);
  const sources = useRef<AudioBufferSourceNode[]>([]),
    raf = useRef(0),
    asr = useRef<Worker | null>(null),
    abortAsr = useRef<(() => void) | null>(null);
  const playheadRef = useRef(0);
  const timeline = useRef<HTMLDivElement>(null);
  const zoomAnchor = useRef<number | null>(null);
  const duration = Math.max(
    0,
    ...tracks.map((t) => t.offset + t.buffer.duration),
  );
  const segments = useMemo(
    () => buildSegments(duration, cuts),
    [duration, cuts],
  );
  function changeZoom(next: number) {
    const el = timeline.current;
    if (next === zoom || !el || !duration) return;
    const left = (el.scrollLeft / el.scrollWidth) * duration;
    const right =
      ((el.scrollLeft + el.clientWidth) / el.scrollWidth) * duration;
    zoomAnchor.current =
      selection.end > selection.start
        ? selection.start
        : playheadRef.current >= left && playheadRef.current <= right
          ? playheadRef.current
          : (left + right) / 2;
    setZoom(next);
  }
  useLayoutEffect(() => {
    const el = timeline.current;
    if (!el || zoomAnchor.current === null || !duration) return;
    el.scrollLeft =
      (zoomAnchor.current / duration) * el.scrollWidth - el.clientWidth * 0.25;
    zoomAnchor.current = null;
  }, [zoom, duration]);
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
  const editingCut =
    cuts.find((c) => c.id === editingCutId) ??
    remaining.find((c) => c.id === editingCutId);
  const shownCues = cues
    .map((cue, index) => ({ cue, index }))
    .filter(({ cue }) =>
      `${cue.speaker ?? cue.speakerHint?.name ?? ""} ${cue.text}`.includes(
        query,
      ),
    );
  const currentCuePage = Math.min(
    cuePage,
    Math.max(0, Math.ceil(shownCues.length / 100) - 1),
  );
  const project = useMemo<Project>(
    () => ({
      version: 1,
      title,
      cuts,
      cues,
      ...(script ? { script } : {}),
      tracks: tracks.map(
        ({ name, size, lastModified, gainDb, offset, muted, voice }) => ({
          name,
          size,
          lastModified,
          gainDb,
          offset,
          muted,
          ...(voice ? { voice } : {}),
        }),
      ),
      music: music.map(
        ({
          name,
          buffer,
          role,
          at,
          gainDb,
          assetId,
          scriptJingleKey,
          builtinId,
        }) => ({
          name,
          duration: buffer.duration,
          role,
          at,
          gainDb,
          ...(assetId ? { assetId } : {}),
          ...(scriptJingleKey ? { scriptJingleKey } : {}),
          ...(builtinId ? { builtinId } : {}),
        }),
      ),
    }),
    [title, cuts, cues, tracks, music, script],
  );
  const audioSignature = useMemo(
    () => JSON.stringify([project.cuts, project.tracks, project.music]),
    [project],
  );
  const checks = review.signature === audioSignature ? review.checks : [];
  const missing = pendingProject
    ? missingSources(
        pendingProject,
        tracks,
        music.map((m) => ({ name: m.name, duration: m.buffer.duration })),
      )
    : null;

  useEffect(() => {
    if (!tracks.length || pendingProject || tracks.some((t) => t.id === "demo"))
      return;
    try {
      localStorage.setItem(draftKey, saveProject(project));
      setSaveStatus("編集内容をこのブラウザに自動保存済み（音声は含みません）");
    } catch {
      setSaveStatus(
        "自動保存できません。「編集を保存」でファイルに保存してください。",
      );
    }
  }, [project, pendingProject, tracks]);

  useEffect(() => {
    if (
      !pendingProject ||
      busy ||
      !missing ||
      missing.voices.length ||
      missing.music.length ||
      restoreAttempt.current === pendingProject
    )
      return;
    restoreAttempt.current = pendingProject;
    void run(() => applyProject(pendingProject));
  }, [pendingProject, tracks, music, busy]);

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
    setMusicPreview(undefined);
  }, []);
  const seek = useCallback(
    (time: number) => {
      stop();
      voicePreview.current = null;
      playheadRef.current = time;
      setPlayhead(time);
      const el = timeline.current;
      if (el && duration) {
        const x = (time / duration) * el.scrollWidth;
        if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth)
          el.scrollLeft = x - el.clientWidth * 0.25;
      }
    },
    [stop, duration],
  );
  const select = useCallback(
    (range: Range) => {
      stop();
      voicePreview.current = null;
      setEditingCutId(null);
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
      voiceAbort.current?.abort();
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
    if (!help) return;
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
  }, [help, busy]);

  useEffect(() => {
    if (!notice) return;
    const timeout = window.setTimeout(() => setNotice(""), 6000);
    return () => window.clearTimeout(timeout);
  }, [notice]);

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
    setEditingCutId(null);
    setHistory((prev) =>
      [...prev.slice(0, historyIndex + 1), next].slice(-100),
    );
    setHistoryIndex(Math.min(99, historyIndex + 1));
  };
  function beginCutEdit(cut: Cut) {
    select({ start: cut.start, end: cut.end });
    seek(cut.start);
    setEditingCutId(cut.id);
  }
  function fineTunedCuts() {
    if (!editingCut) return cuts;
    return applyCutRange(
      cuts,
      { id: editingCut.id, reason: editingCut.reason, ...selection },
      duration,
    );
  }
  function applyFineCut() {
    try {
      changeCuts(fineTunedCuts());
      setNotice(
        "カット範囲を反映しました。履歴から何度でも微調整でき、「元に戻す」で変更前に戻せます。",
      );
    } catch (e) {
      setError(message(e));
    }
  }
  function resetCandidates() {
    stop();
    setCandidates([]);
    setDismissed([]);
    if (!cuts.some((c) => c.id === editingCutId)) setEditingCutId(null);
  }
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
    setEditingCutId(null);
    setTracks((prev) =>
      prev.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    );
    setCandidates([]);
  };
  const updateMusic = (id: string, patch: Partial<MusicClip>) => {
    if (
      patch.role === "bgm" &&
      music.some((m) => m.id !== id && m.role === "bgm")
    ) {
      setError("BGMは1曲までです。今のBGMを外してから変更してください。");
      return;
    }
    stop();
    setMusic((prev) => prev.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  async function previewBuiltInMusic(id: string) {
    if (musicPreview === id) {
      stop();
      return;
    }
    await run(async () => {
      const ctx = audioContext();
      await ctx.resume();
      setBusy("内蔵音源を読み込んでいます…");
      const clip = await loadBuiltInMusic(id);
      const length = clip.buffer.duration;
      sources.current = schedule(
        ctx,
        [
          {
            buffer: clip.buffer,
            when: 0,
            offset: 0,
            duration: length,
            gain: 10 ** (clip.gainDb / 20),
            fade: 0.05,
          },
        ],
        0,
        length,
        ctx.currentTime + 0.03,
      );
      const source = sources.current[0];
      source.onended = () => {
        if (sources.current.includes(source)) stop();
      };
      setMusicPreview(id);
      setPlaying(true);
    });
  }

  async function addBuiltInMusic(id: string, forScript = false) {
    await run(async () => {
      setBusy("内蔵音源を読み込んでいます…");
      const clip = await loadBuiltInMusic(id);
      if (forScript) {
        setJingleSource(clip);
        setNotice(
          "原稿用にジングルを準備しました。下で挿入候補を探し、試聴して配置してください。まだ番組には挿入していません。",
        );
        return;
      }
      if (
        clip.role !== "jingle" &&
        music.some((m) => m.builtinId === id && m.role === clip.role)
      )
        return;
      const keep =
        clip.role === "bgm" ? music.filter((m) => m.role !== "bgm") : music;
      if (keep.length >= 20) throw new Error("音楽は20本までです。");
      setMusic([...keep, { ...clip, at: playheadRef.current }]);
      setEdited(true);
      setNotice(
        clip.role === "bgm"
          ? "BGMを会話の下に追加しました。OP・ED・ジングルの間は止まります。声と一緒に聞いて音量を調整してください。"
          : `${clip.name}を${clip.role === "jingle" ? `元音声の${formatTime(playheadRef.current)}に` : ""}追加しました。`,
      );
    });
  }

  async function adjustVoice(
    buffer: AudioBuffer,
    settings: VoiceSettings,
    range?: Range,
    extraBytes = 0,
  ) {
    const frames = range
      ? Math.ceil((range.end - range.start) * buffer.sampleRate)
      : buffer.length;
    const used =
      tracks.reduce((n, t) => n + trackBytes(t), 0) +
      music.reduce((n, m) => n + pcmBytes(m.buffer), 0);
    if (
      used + extraBytes + frames * buffer.numberOfChannels * 4 >
      MAX_PCM_BYTES
    )
      throw new Error(
        "音質調整用のメモリが足りません。不要な素材を外すか、反映済みの音質調整をいったん解除してください。",
      );
    const controller = new AbortController();
    voiceAbort.current = controller;
    setVoiceRunning(true);
    try {
      const { processVoice } = await import("./voice-engine");
      return await processVoice(
        buffer,
        settings,
        setBusy,
        controller.signal,
        range,
      );
    } finally {
      voiceAbort.current = null;
      setVoiceRunning(false);
    }
  }

  async function previewVoice(track: Track, settings = originalVoice) {
    await run(async () => {
      const ctx = audioContext();
      await ctx.resume();
      if (voicePreview.current?.id !== track.id) {
        const selected = selection.end > selection.start;
        const start = Math.max(
          0,
          (selected ? selection.start : playheadRef.current) - track.offset,
        );
        const end = Math.min(
          track.buffer.duration,
          start + 10,
          selected ? selection.end - track.offset : Infinity,
        );
        if (end <= start)
          throw new Error(
            "この音声がある場所を波形で選んでから試聴してください。",
          );
        voicePreview.current = { id: track.id, range: { start, end } };
      }
      const range = voicePreview.current.range;
      const buffer = await adjustVoice(track.buffer, settings, range);
      const start = ctx.currentTime + 0.06;
      sources.current = schedule(
        ctx,
        [
          {
            buffer,
            when: 0,
            offset: 0,
            duration: buffer.duration,
            gain: 10 ** (track.gainDb / 20),
            fade: 0.005,
          },
        ],
        0,
        buffer.duration,
        start,
      );
      setPlaying(true);
      setNotice(
        `${track.name}：${hasVoiceEffects(settings) ? "調整後" : "原音"}を単独で試聴中（全体への反映はまだ行いません）。`,
      );
      const tick = () => {
        const time = Math.max(0, ctx.currentTime - start);
        if (time >= buffer.duration) {
          stop();
          return;
        }
        playheadRef.current = track.offset + range.start + time;
        setPlayhead(playheadRef.current);
        raf.current = requestAnimationFrame(tick);
      };
      raf.current = requestAnimationFrame(tick);
    });
  }

  async function applyVoice(track: Track, settings: VoiceSettings) {
    await run(async () => {
      const processed = await adjustVoice(track.buffer, settings);
      updateTrack(track.id, { voice: settings, processed });
      setEdited(true);
      setNotice(
        "音質調整を全体に反映しました。編集後の再生と書き出しに使われます。原音は保持しています。",
      );
    });
  }

  async function importFiles(files: File[]) {
    if (busy) return;
    if (
      initialDraft.project &&
      !pendingProject &&
      !tracks.length &&
      !window.confirm(
        "新しい素材を読み込むと、このブラウザの前回の自動保存を置き換えます。前回の編集を残す場合はキャンセルして再開してください。",
      )
    )
      return;
    await run(async () => {
      if (tracks.length + files.length > 8)
        throw new Error("声トラックは8本までです。");
      const next = [...tracks];
      let bytes =
        next.reduce((n, t) => n + trackBytes(t), 0) +
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
      setInitialDraft({});
      setCandidates([]);
      setNotice(
        "読み込みました。分離音声は同じ開始時刻で並びます。混合音声との二重再生にご注意ください。",
      );
    });
  }

  async function play(
    mode = edited,
    range?: Range,
    fromStart = false,
    previewCuts?: Cut[],
  ) {
    if (playing && !range && !fromStart) {
      stop();
      return;
    }
    try {
      stop();
      voicePreview.current = null;
      const ctx = audioContext();
      await ctx.resume();
      const selectedPlan = mode
        ? previewCuts
          ? buildPlacements(tracks, buildSegments(duration, previewCuts), music)
          : plan
        : buildPlacements(rawTracks(tracks), buildSegments(duration, []), []);
      const begin = fromStart
        ? 0
        : range
          ? Math.max(0, range.start - 1.5)
          : playheadRef.current;
      const finish = range ? Math.min(duration, range.end + 2) : duration;
      let from = mode ? sourceToOutput(begin, selectedPlan.mapping) : begin;
      if (begin === 0 || (!range && from >= selectedPlan.duration - 0.05))
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
    setEditingCutId(null);
    setDismissed([]);
    setCandidates(
      [
        ...silenceCandidates(
          tracks,
          duration,
          threshold,
          pauseLength,
          keepSeconds,
        ),
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
        rawTracks(tracks),
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
        worker.onmessage = async (event) => {
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
            finish();
            try {
              await receiveCues(data.cues);
              resolve();
            } catch (error) {
              reject(error);
            }
          }
        };
        worker.postMessage({ audio, model, offset: range.start }, [
          audio.buffer,
        ]);
      });
    });
  }

  function updateCue(index: number, cue: Cue) {
    setCues((prev) => prev.map((c, i) => (i === index ? cue : c)));
    setCandidates([]);
    setDismissed([]);
  }
  function changeScript(next: SavedScript | undefined) {
    setScript(next);
    setCues((prev) => prev.map(clearSpeakerHint));
  }
  async function matchSpeakers(source: Cue[]) {
    setBusy("原稿から話者候補を探しています…");
    return scriptJob({ type: "match", text: script?.text ?? "", cues: source });
  }
  async function receiveCues(source: Cue[]) {
    // Keep ASR output even if optional script matching fails or times out.
    setCues(source);
    setCandidates([]);
    setDismissed([]);
    setTab("transcript");
    setCuePage(0);
    setQuery("");
    if (parsedScript.turns.length) {
      let matched: Cue[];
      try {
        matched = await matchSpeakers(source);
      } catch (error) {
        throw new Error(
          `文字起こしは保存しましたが、話者の照合に失敗しました。${message(error)}`,
        );
      }
      setCues(matched);
      setNotice(
        `文字起こしを読み込み、${matched.filter((c) => c.speakerHint).length}区間に話者候補を付けました。再生して確認してください。`,
      );
    } else
      setNotice(
        "文字起こしを読み込みました。人名・専門用語・無音部分の誤認識を確認してください。",
      );
  }

  function save() {
    download(
      saveProject(project),
      `${safeName(title)}.studio.json`,
      "application/json",
    );
    setNotice(
      "編集内容を保存しました。再開時には、このファイルと同じ元音声を読み込んでください。",
    );
  }
  async function restore(file: File) {
    await run(async () => {
      if (file.size > 10000000)
        throw new Error("編集ファイルは10 MBまでです。");
      const project = readProject(await file.text());
      beginRestore(project);
    });
  }
  function beginRestore(project: Project) {
    if (
      tracks.length &&
      !window.confirm(
        "現在の作業を置き換えて、保存済みの編集を開きます。よろしいですか？",
      )
    )
      return;
    stop();
    restoreAttempt.current = null;
    setPendingProject(project);
    setInitialDraft({});
    setTracks([]);
    setMusic([]);
    setJingleSource(undefined);
    setCues([]);
    setScript(undefined);
    setHistory([[]]);
    setHistoryIndex(0);
    setEditingCutId(null);
    setCandidates([]);
    setSelection(emptyRange);
    setTitle(project.title);
    setStep("source");
    seek(0);
    setSaveStatus("");
  }
  async function applyProject(project: Project) {
    try {
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
      setBusy("音楽を復元しています（内蔵音源は自動で読み込みます）…");
      const restoredMusic = await restoreMusic(project.music, music);
      let extraBytes = 0;
      for (const track of restored) {
        if (!track.voice || !hasVoiceEffects(track.voice)) continue;
        track.processed = await adjustVoice(
          track.buffer,
          track.voice,
          undefined,
          extraBytes,
        );
        extraBytes += pcmBytes(track.processed);
      }
      setTracks(restored);
      setMusic(restoredMusic);
      setCues(project.cues);
      setScript(project.script);
      setTitle(project.title);
      setHistory([project.cuts]);
      setHistoryIndex(0);
      setEditingCutId(null);
      setCandidates([]);
      setSelection(emptyRange);
      seek(0);
      setPendingProject(null);
      setStep("edit");
      setNotice("編集内容を復元しました。");
    } catch (e) {
      // Keep the saved draft untouched; let the user retry with matching files.
      throw e;
    }
  }

  async function exportAudio() {
    await run(async () => {
      const bytes = await renderExport(plan, format, normalize, setBusy);
      download(
        bytes,
        `${safeName(title)}.${format}`,
        format === "mp3" ? "audio/mpeg" : "audio/wav",
      );
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
          </span>
        </a>
        <div className="top-actions">
          <span className="privacy">
            <ShieldCheck size={15} />
            音声・編集は端末内で処理
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
            v0.8.1
          </a>
        </div>
      </header>
      <fieldset disabled={!!busy} className="app-fieldset">
        <main>
          <section className="project-heading">
            <div>
              <label className="project-label" htmlFor="episode-title">
                エピソード名
              </label>
              <input
                id="episode-title"
                className="project-title"
                aria-label="エピソード名"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                maxLength={100}
              />
              <p className="save-status" role="status">
                {tracks.length
                  ? tracks.some((t) => t.id === "demo")
                    ? "操作デモは自動保存されません"
                    : saveStatus
                  : "音声・字幕・原稿は端末内で処理します。元ファイルは変更しません。"}
              </p>
            </div>
            <div className="project-actions">
              <button
                className="secondary"
                onClick={() => projectInput.current?.click()}
              >
                <FolderOpen size={16} />
                編集ファイルを開く
              </button>
              <button
                className="secondary"
                onClick={save}
                disabled={!tracks.length || !!pendingProject}
              >
                <Save size={16} />
                編集を保存
              </button>
            </div>
          </section>
          <WorkflowNav
            step={step}
            hasAudio={!!tracks.length && !pendingProject}
            onChange={setStep}
          />
          {initialDraft.project && !tracks.length && !pendingProject ? (
            <section className="resume-banner" aria-label="前回の編集">
              <div>
                <strong>前回の編集：{initialDraft.project.title}</strong>
                <p>
                  編集内容を再開できます。元の音声ファイルは選び直してください。
                </p>
              </div>
              <button
                className="secondary"
                onClick={() => beginRestore(initialDraft.project!)}
              >
                前回の編集を再開
              </button>
              <button
                className="text-button"
                onClick={() => {
                  if (
                    !window.confirm(
                      "このブラウザの前回の編集内容を削除して、新しく始めます。保存した編集ファイルや元音声は削除されません。",
                    )
                  )
                    return;
                  try {
                    localStorage.removeItem(draftKey);
                    setInitialDraft({});
                  } catch {
                    setError(
                      "自動保存を削除できません。ブラウザの設定を確認してください。",
                    );
                  }
                }}
              >
                新しく始める
              </button>
            </section>
          ) : null}
          {initialDraft.error ? (
            <p className="review-warning">{initialDraft.error}</p>
          ) : null}
          {pendingProject && missing ? (
            <section className="resume-banner" aria-label="再開に必要な素材">
              <div>
                <strong>再開に必要な素材を選んでください</strong>
                <p>
                  すべて揃うと、カット・字幕・音量・音質設定を自動で復元します。音質調整は元音声から再処理します。音声の名前・サイズ・更新日時を照合します。
                </p>
                {missing.voices.length ? (
                  <p>収録音声：{missing.voices.join("、")}</p>
                ) : null}
                {missing.music.length ? (
                  <p>音楽：{missing.music.join("、")}</p>
                ) : null}
              </div>
              {missing.voices.length ? (
                <button
                  className="secondary"
                  onClick={() => input.current?.click()}
                >
                  収録音声を選ぶ
                </button>
              ) : null}
              {missing.music.length ? (
                <button
                  className="secondary"
                  onClick={() => musicInput.current?.click()}
                >
                  音楽を選ぶ
                </button>
              ) : null}
              {!missing.voices.length && !missing.music.length ? (
                <button
                  className="secondary"
                  onClick={() => void run(() => applyProject(pendingProject))}
                >
                  設定の復元を再試行
                </button>
              ) : null}
              <button
                className="text-button"
                onClick={() => {
                  stop();
                  setPendingProject(null);
                  setTracks([]);
                  setMusic([]);
                  setInitialDraft(loadDraft());
                  setTitle("新しいエピソード");
                  setSaveStatus("");
                }}
              >
                再開をやめる
              </button>
            </section>
          ) : null}
          <div className={`workspace${tracks.length ? "" : " is-empty"}`}>
            {step === "source" && tracks.length > 0 ? (
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
                  全員の声が入った1本、または話者別の音声を選びます。同じ会話を二重に追加しないでください。
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
                          if (
                            (cuts.length || cues.length) &&
                            !window.confirm(
                              "素材を外すと、カットと文字起こしがリセットされます。先に編集を保存しましたか？",
                            )
                          )
                            return;
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
                <p className="hint">
                  元の音声ファイルは保管してください。「編集を保存」で、別のPCでも開ける編集ファイルを保存できます。
                </p>
                {tracks.length && !pendingProject ? (
                  <NextStep step={step} onChange={setStep} />
                ) : null}
              </aside>
            ) : null}
            <section className="editor" aria-label="音声編集">
              {tracks.length > 0 ? (
                <>
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
                          setEditingCutId(null);
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
                          setEditingCutId(null);
                        }}
                      >
                        <Redo2 size={17} />
                      </button>
                      <div
                        className="zoom-controls"
                        role="group"
                        aria-label="タイムラインの拡大・縮小"
                      >
                        <span>拡大</span>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="タイムラインを縮小"
                          title="縮小"
                          disabled={zoom <= 1}
                          onClick={() => changeZoom(Math.max(1, zoom / 2))}
                        >
                          <Minus size={17} />
                        </button>
                        <select
                          aria-label="波形の拡大率"
                          value={zoom}
                          onChange={(e) => changeZoom(Number(e.target.value))}
                        >
                          <option value={1}>全体</option>
                          <option value={2}>2倍</option>
                          <option value={4}>4倍</option>
                          <option value={8}>8倍</option>
                          <option value={16}>16倍</option>
                          <option value={32}>32倍</option>
                        </select>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label="タイムラインを拡大"
                          title="拡大"
                          disabled={zoom >= 32}
                          onClick={() => changeZoom(Math.min(32, zoom * 2))}
                        >
                          <Plus size={17} />
                        </button>
                      </div>
                    </div>
                  </div>
                  <div className="transport">
                    <button
                      className="transport-back"
                      aria-label="先頭へ"
                      onClick={() => seek(0)}
                    >
                      <SkipBack size={19} />
                    </button>
                    <button
                      className="play-button"
                      aria-label={playing ? "停止" : "再生"}
                      onClick={() => void play()}
                    >
                      {playing ? (
                        <Pause size={21} fill="currentColor" />
                      ) : (
                        <Play size={21} fill="currentColor" />
                      )}
                    </button>
                    <div className="time-display">
                      <small className="time-context">元音声</small>
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
                      書き出し <strong>{formatTime(plan.duration)}</strong>
                    </span>
                  </div>
                </>
              ) : null}
              {!tracks.length ? (
                <div
                  className="dropzone"
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => {
                    e.preventDefault();
                    void importFiles([...e.dataTransfer.files]);
                  }}
                >
                  <Upload size={28} aria-hidden="true" />
                  <h2>Zoomの録画・音声を読み込む</h2>
                  <p>
                    ファイルをここにドロップするか、下のボタンで選びます。
                    <br />
                    MP4は音声だけを取り出します。M4A・MP3・WAVにも対応。
                  </p>
                  <button
                    className="primary"
                    onClick={() => input.current?.click()}
                  >
                    <Upload size={17} />
                    音声・動画を選ぶ
                  </button>
                  <button className="text-button" onClick={() => void demo()}>
                    操作デモを試す <ArrowRight size={15} />
                  </button>
                  <small>
                    PC版 Chrome / Edge 推奨 · 1ファイル350 MB / 45分まで
                  </small>
                  <p className="hint">
                    全員の声が入った1本、または話者別の音声を選んでください。
                    <br />
                    同じ会話を二重に重ねないようにします。
                  </p>
                </div>
              ) : (
                <>
                  <div className="timeline-scroll" ref={timeline}>
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
                  {editingCut ? (
                    <CutEditor
                      cut={editingCut}
                      draft={selection}
                      tracks={tracks}
                      duration={duration}
                      existing={cuts.some((c) => c.id === editingCut.id)}
                      overlap={cuts.some(
                        (c) =>
                          c.id !== editingCut.id &&
                          c.start < selection.end &&
                          c.end > selection.start,
                      )}
                      playing={playing}
                      onChange={(range) => {
                        stop();
                        setSelection(range);
                      }}
                      onPreview={(mode) => {
                        void play(
                          mode,
                          selection,
                          false,
                          mode ? fineTunedCuts() : undefined,
                        );
                      }}
                      onStop={stop}
                      onApply={applyFineCut}
                      onCancel={() => {
                        stop();
                        setEditingCutId(null);
                        setSelection({
                          start: editingCut.start,
                          end: editingCut.end,
                        });
                      }}
                    />
                  ) : (
                    <>
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
                      <div className="selection-preview">
                        <span>
                          {selection.end > selection.start
                            ? `選択 ${formatTime(selection.start, true)}–${formatTime(selection.end, true)}`
                            : "波形をドラッグして範囲を選択。クリックすると再生位置が移動します。"}
                        </span>
                        <button
                          className="text-button"
                          disabled={selection.end <= selection.start}
                          onClick={() => void play(false, selection)}
                        >
                          <Play size={14} />
                          カット前を聞く
                        </button>
                        <button
                          className="text-button"
                          disabled={selection.end <= selection.start}
                          onClick={() => void play(true, selection)}
                        >
                          <Play size={14} />
                          編集後を聞く
                        </button>
                      </div>
                    </>
                  )}
                  {step === "sound" ? (
                    <div className="mix-section">
                      <div className="section-heading">
                        <h3>声の音量・ノイズ</h3>
                        <span>別々に録った音声は開始位置を調整</span>
                      </div>
                      {tracks.map((t) => (
                        <div className="voice-track" key={t.id}>
                          <div className="mixer">
                            <button
                              className="icon-button"
                              aria-label={`${t.name} ${t.muted ? "ミュート解除" : "ミュート"}`}
                              onClick={() =>
                                updateTrack(t.id, { muted: !t.muted })
                              }
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
                                  if (
                                    (cuts.length || cues.length) &&
                                    !window.confirm(
                                      "開始位置を変更すると、カットと文字起こしがリセットされます。変更しますか？",
                                    )
                                  )
                                    return;
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
                          <VoicePanel
                            name={t.name}
                            applied={t.voice}
                            onPreview={(settings) =>
                              void previewVoice(t, settings)
                            }
                            onApply={(settings) => void applyVoice(t, settings)}
                            onClear={() => {
                              updateTrack(t.id, {
                                voice: undefined,
                                processed: undefined,
                              });
                              setNotice(
                                "音質調整を解除しました。カット・音量設定はそのままです。",
                              );
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
              {tracks.length > 0 ? (
                <div className="edit-log">
                  <div className="section-heading">
                    <h3>
                      カット履歴 <span>{cuts.length}</span>
                    </h3>
                    <small>短縮 {formatTime(removed)} · 元に戻せます</small>
                  </div>
                  {cuts.length ? (
                    <div
                      className="log-list"
                      role="region"
                      aria-label="カット履歴一覧"
                      tabIndex={0}
                    >
                      {cuts.map((c) => (
                        <div className="log-row" key={c.id}>
                          <button
                            className="text-button"
                            onClick={() => {
                              select(c);
                              seek(c.start);
                            }}
                          >
                            {formatTime(c.start, true)}–
                            {formatTime(c.end, true)}
                          </button>
                          <span>{c.reason}</span>
                          <button
                            className="text-button"
                            onClick={() => beginCutEdit(c)}
                          >
                            微調整
                          </button>
                          <button
                            className="icon-button"
                            onClick={() =>
                              changeCuts(cuts.filter((k) => k.id !== c.id))
                            }
                            aria-label={`${formatTime(c.start)} のカットを取り消す`}
                          >
                            <Undo2 size={14} />
                          </button>
                          <button
                            className="text-button"
                            onClick={() => {
                              select(c);
                              void play(true, c);
                            }}
                          >
                            つなぎ目を聞く
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="hint">
                      波形をドラッグして範囲を選ぶか、右の候補から確認します。
                    </p>
                  )}
                </div>
              ) : null}
            </section>
            {step !== "source" ? (
              <aside className="inspector">
                {step === "edit" ? (
                  <div className="tabs" aria-label="確認方法">
                    <button
                      aria-pressed={tab === "candidates"}
                      onClick={() => setTab("candidates")}
                    >
                      <Scissors size={16} />
                      カット候補
                    </button>
                    <button
                      aria-pressed={tab === "transcript"}
                      onClick={() => setTab("transcript")}
                    >
                      <FileText size={16} />
                      文字起こし
                    </button>
                  </div>
                ) : null}
                {step === "edit" && tab === "candidates" ? (
                  <div className="inspector-content">
                    <div className="section-heading">
                      <h2>カット候補を確認</h2>
                      <span>{remaining.length}件</span>
                    </div>
                    <p className="hint">
                      長い間の中央を詰め、前後に余白を残します。
                      <br />
                      採用するまで、音声は残ります。
                    </p>
                    <label className="pause-preset">
                      間の残し方
                      <select
                        aria-label="間の残し方"
                        value={pausePreset}
                        onChange={(e) => {
                          const preset = pausePresets.find(
                            (p) => p.id === e.target.value,
                          );
                          if (!preset) return;
                          resetCandidates();
                          setPauseLength(preset.minimum);
                          setKeepSeconds(preset.keep);
                        }}
                      >
                        {pausePresets.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                        {pausePreset === "custom" ? (
                          <option value="custom">カスタム</option>
                        ) : null}
                      </select>
                    </label>
                    <p className="hint compact">
                      {pauseLength}秒以上の静かな間を、{keepSeconds}秒残します。
                    </p>
                    <details className="advanced-settings">
                      <summary>検出条件を細かく設定</summary>
                      <div className="detection-settings">
                        <label>
                          静かな区間{" "}
                          <select
                            aria-label="無音検出のしきい値"
                            value={threshold ?? "auto"}
                            onChange={(e) => {
                              resetCandidates();
                              setThreshold(
                                e.target.value === "auto"
                                  ? null
                                  : Number(e.target.value),
                              );
                            }}
                          >
                            <option value="auto">
                              自動（慎重に判定・推奨）
                            </option>
                            <option value={-55}>
                              −55 dB（ごく静かな区間）
                            </option>
                            <option value={-50}>−50 dB（慎重）</option>
                            <option value={-45}>−45 dB</option>
                            <option value={-35}>−35 dB（小声に注意）</option>
                          </select>
                        </label>
                        <label>
                          探す間の長さ（秒以上）{" "}
                          <input
                            type="number"
                            min={0.5}
                            max={10}
                            step={0.1}
                            aria-label="無音検出の長さ"
                            value={pauseLength}
                            onChange={(e) => {
                              const value = e.target.valueAsNumber;
                              if (Number.isFinite(value)) {
                                resetCandidates();
                                setPauseLength(
                                  Math.max(0.5, Math.min(10, value)),
                                );
                              }
                            }}
                          />
                        </label>
                        <label>
                          残す間の合計（秒）
                          <input
                            type="number"
                            min={0.3}
                            max={3}
                            step={0.05}
                            aria-label="残す間の長さ"
                            value={keepSeconds}
                            onChange={(e) => {
                              const value = e.target.valueAsNumber;
                              if (Number.isFinite(value)) {
                                resetCandidates();
                                setKeepSeconds(
                                  Math.max(0.3, Math.min(3, value)),
                                );
                              }
                            }}
                          />
                        </label>
                      </div>
                      <p className="hint compact">
                        小声・息継ぎの判別は完全ではありません。採用前につなぎ目を試聴してください。条件の変更は、採用済みのカットには影響しません。
                      </p>
                    </details>
                    <button
                      className="primary full"
                      disabled={!tracks.length}
                      onClick={findCandidates}
                    >
                      <Search size={16} />
                      候補を探す
                    </button>
                    <p className="hint compact">
                      {cues.length
                        ? `文字起こし${cues.length}区間から、言い直し・収録中断の候補も探します。`
                        : "言い直し・収録中断も探す場合は、先に文字起こしを読み込んでください。"}
                      原稿との違いだけでは判定しません。
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
                                    ? c.reason === "収録中断の可能性"
                                      ? "収録中断？"
                                      : "言い直し"
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
                                前後を聞く
                              </button>
                              <button onClick={() => beginCutEdit(c)}>
                                <Scissors size={13} />
                                範囲を調整
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
                                    "カットしました。履歴からつなぎ目を聞いたり、範囲を微調整したりできます。",
                                  );
                                  select(c);
                                }}
                              >
                                <Check size={13} />
                                カットする
                              </button>
                              <button
                                aria-label="この候補を残す"
                                onClick={() =>
                                  setDismissed((prev) => [...prev, c.id])
                                }
                              >
                                残す
                              </button>
                            </div>
                          </article>
                        ))
                      ) : (
                        <div className="quiet-state">
                          <p>
                            {candidates.length
                              ? "すべての候補を確認しました。波形から手動でカットすることもできます。"
                              : cues.length
                                ? "「候補を探す」で、静かな間や言い直し・収録中断を確認します。"
                                : "「候補を探す」で静かな区間を探せます。言い直しも探す場合は、先に文字起こしをしてください。"}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
                {step === "edit" && tab === "transcript" ? (
                  <div className="inspector-content">
                    <div className="section-heading">
                      <h2>文字起こし</h2>
                      <span>{cues.length}区間</span>
                    </div>
                    <details
                      className="transcript-tools"
                      open={cues.length === 0}
                    >
                      <summary>文字起こし・字幕を読み込む</summary>
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
                          disabled={
                            !tracks.some((t) => !t.muted) || duration <= 0
                          }
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
                    </details>
                    <ScriptPanel
                      script={script}
                      parsed={parsedScript}
                      hasCues={!!cues.length}
                      onChange={changeScript}
                      onImport={(file) =>
                        void run(async () => {
                          if (file.size > 10_000_000)
                            throw new Error("原稿ファイルは10 MBまでです。");
                          setBusy("原稿の本文を読み込んでいます…");
                          const text = await scriptJob({
                            type: "file",
                            name: file.name,
                            bytes: await file.arrayBuffer(),
                          });
                          changeScript({ text, name: file.name.slice(0, 200) });
                          setNotice(
                            "原稿を読み込みました。読み取った話者と注釈を確認してから、話者候補を探してください。",
                          );
                        })
                      }
                      onMatch={() =>
                        void run(async () => {
                          const matched = await matchSpeakers(cues);
                          setCues(matched);
                          setNotice(
                            `${matched.filter((c) => c.speakerHint).length}区間に話者候補を付けました。音声を聞いて確定・修正してください。`,
                          );
                        })
                      }
                    />
                    {cues.length ? (
                      <p className="hint speaker-count">
                        名前あり {cues.filter((c) => c.speaker).length} · 候補{" "}
                        {cues.filter((c) => c.speakerHint && !c.speaker).length}{" "}
                        · 未設定{" "}
                        {
                          cues.filter((c) => !c.speaker && !c.speakerHint)
                            .length
                        }
                      </p>
                    ) : null}
                    <datalist id="speaker-names">
                      {speakerNames.map((name) => (
                        <option key={name} value={name} />
                      ))}
                    </datalist>
                    <label className="search-box">
                      <Search size={15} />
                      <input
                        aria-label="文字起こしを検索"
                        placeholder="発言・話者名を検索…"
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
                            <CueSpeaker
                              cue={cue}
                              label={formatTime(cue.start)}
                              onChange={(next) => updateCue(index, next)}
                            />
                            <textarea
                              aria-label={`${formatTime(cue.start)} の発言`}
                              value={cue.text}
                              onChange={(e) =>
                                updateCue(index, {
                                  ...clearSpeakerHint(cue),
                                  text: e.target.value,
                                })
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
                      時刻を押すと元の発言を再生します。話者候補は推定です。短い相づち・大きな言い換え・原稿にない発言は、聞いて名前を入力してください。字幕に名前が入るのは、入力・確定したものと元字幕の名前だけです。
                    </p>
                  </div>
                ) : null}
                {step === "sound" ? (
                  <div className="inspector-content">
                    <div className="section-heading">
                      <h2>音楽を加える</h2>
                    </div>
                    <p className="hint">
                      OP・EDは番組の前後、ジングルは話題の間に。BGMは会話の下に小さく重ねます。
                    </p>
                    <MusicLibrary
                      music={music}
                      pendingSource={jingleSource}
                      previewing={musicPreview}
                      onPreview={(id) => void previewBuiltInMusic(id)}
                      onAdd={(id, forScript) =>
                        void addBuiltInMusic(id, forScript)
                      }
                    />
                    <button
                      className="secondary full"
                      onClick={() => {
                        musicImportRole.current = undefined;
                        musicInput.current?.click();
                      }}
                    >
                      <Plus size={16} />
                      手持ちの音楽ファイルを追加
                    </button>
                    <JinglePanel
                      text={script?.text ?? ""}
                      cues={cues}
                      duration={duration}
                      cuts={cuts}
                      music={music}
                      pendingSource={jingleSource}
                      playhead={playhead}
                      onOpenScript={() => {
                        setStep("edit");
                        setTab("transcript");
                      }}
                      onLoadMusic={() => {
                        musicImportRole.current = "jingle";
                        musicInput.current?.click();
                      }}
                      onPlace={(source, key, at) => {
                        try {
                          if (jingleSource?.id === source && music.length >= 20)
                            throw new Error("音楽は20本までです。");
                          const next = placeScriptJingle(
                            jingleSource?.id === source
                              ? [...music, jingleSource]
                              : music,
                            source,
                            key,
                            at,
                            duration,
                            crypto.randomUUID(),
                          );
                          stop();
                          setMusic(next);
                          if (jingleSource?.id === source)
                            setJingleSource(undefined);
                          setEdited(true);
                          setNotice(
                            "ジングルを配置しました。挿入後を聞き、必要なら下の音源設定で微調整してください。",
                          );
                        } catch (e) {
                          setError(message(e));
                        }
                      }}
                      onPreview={(at, edited) =>
                        void play(edited, { start: at, end: at })
                      }
                    />
                    {music.length ? (
                      <h3 className="placed-music-title">追加した音楽を調整</h3>
                    ) : null}
                    {music.map((m, musicIndex) => (
                      <article className="music-card" key={m.id}>
                        <div className="section-heading">
                          <strong title={m.name}>
                            {musicIndex + 1}. {m.name}
                          </strong>
                          <button
                            aria-label={`${musicIndex + 1}. ${m.name} を外す`}
                            className="icon-button"
                            onClick={() => {
                              stop();
                              setMusic(
                                music.filter((clip) => clip.id !== m.id),
                              );
                            }}
                          >
                            <X size={15} />
                          </button>
                        </div>
                        <label>
                          用途
                          <select
                            aria-label={`音楽 ${musicIndex + 1} の用途`}
                            value={m.role}
                            onChange={(e) =>
                              updateMusic(m.id, {
                                role: e.target.value as MusicClip["role"],
                                gainDb:
                                  e.target.value === "bgm"
                                    ? -26
                                    : m.role === "bgm"
                                      ? -12
                                      : m.gainDb,
                                scriptJingleKey: undefined,
                              })
                            }
                          >
                            <option value="opening">オープニング</option>
                            <option value="ending">エンディング</option>
                            <option value="jingle">ジングル</option>
                            <option value="bgm">BGM（会話に重ねる）</option>
                          </select>
                        </label>
                        {m.role === "jingle" ? (
                          <label>
                            挿入位置（元音声・秒）
                            <input
                              aria-label={`音楽 ${musicIndex + 1} の挿入位置（秒）`}
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
                            aria-label={`音楽 ${musicIndex + 1} の音量`}
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
                          {m.role === "bgm"
                            ? `${formatTime(m.buffer.duration)}の音源を会話中に繰り返す · 前後をフェード`
                            : `${formatTime(m.buffer.duration)} · 前後を短くフェード`}
                          {m.builtinId ? " · 内蔵音源" : ""}
                        </small>
                      </article>
                    ))}
                    <div className="info-note">
                      BGMは1曲まで。会話部分で繰り返し、OP・ED・ジングル中は止まります。自動で声量を判断する機能ではないため、声が聞き取りやすい音量に調整してください。内蔵音源は次回の編集再開時も自動で読み込みます。
                    </div>
                  </div>
                ) : null}
                {step === "export" ? (
                  <DeliveryPanel
                    duration={plan.duration}
                    cutCount={cuts.length}
                    remaining={remaining.length}
                    checks={checks}
                    onCheck={(index, value) =>
                      setReview({
                        signature: audioSignature,
                        checks: [0, 1, 2].map((i) =>
                          i === index ? value : !!checks[i],
                        ),
                      })
                    }
                    onListen={() => {
                      setEdited(true);
                      void play(true, undefined, true);
                    }}
                  >
                    <label>
                      ファイル形式
                      <select
                        value={format}
                        onChange={(e) =>
                          setFormat(e.target.value as "wav" | "mp3")
                        }
                      >
                        <option value="mp3">MP3（配布用）</option>
                        <option value="wav">WAV（再編集用・大容量）</option>
                      </select>
                    </label>
                    <label className="checkbox-label">
                      <input
                        type="checkbox"
                        checked={normalize}
                        onChange={(e) => setNormalize(e.target.checked)}
                      />
                      番組全体を聞きやすい音量に調整する
                    </label>
                    <details className="advanced-settings">
                      <summary>音量調整と出力形式の詳細</summary>
                      <p className="hint">
                        音量調整は書き出し時のみ、−16
                        LUFS目標の単一パス処理です。プレビューには反映されず、目標値と差が出る場合があります。MP3は192
                        kbps、WAVは44.1 kHz / 16 bit / stereoです。
                      </p>
                    </details>
                    {!plan.placements.length ? (
                      <p className="review-warning">
                        再生できる音声がありません。ミュート設定やカット範囲を確認してください。
                      </p>
                    ) : null}
                    <button
                      className="primary full"
                      disabled={
                        !!busy || !plan.placements.length || plan.duration <= 0
                      }
                      onClick={() => void exportAudio()}
                    >
                      <Download size={16} />
                      {format.toUpperCase()}を書き出す
                    </button>
                  </DeliveryPanel>
                ) : null}
                <NextStep step={step} onChange={setStep} />
              </aside>
            ) : null}
          </div>
          <footer>
            <span>JAEIS Podcast Studio</span>
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
                if (
                  cues.length &&
                  !window.confirm(
                    "現在の文字起こしと話者の確認結果を置き換えます。必要なら先に編集を保存してください。",
                  )
                )
                  return;
                await receiveCues(parsed);
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
            const requestedRole = musicImportRole.current;
            musicImportRole.current = undefined;
            if (f)
              void run(async () => {
                if (music.length >= 20) throw new Error("音楽は20本までです。");
                const buffer = await decode(f, setBusy);
                if (buffer.duration > 180)
                  throw new Error(
                    "音楽は3分以内の音源を選んでください。BGMは会話の長さに合わせて繰り返します。",
                  );
                if (
                  tracks.reduce((s, t) => s + trackBytes(t), 0) +
                    music.reduce((s, m) => s + pcmBytes(m.buffer), 0) +
                    pcmBytes(buffer) >
                  MAX_PCM_BYTES
                )
                  throw new Error("素材の合計サイズが大きすぎます。");
                const clip: MusicClip = {
                  id: crypto.randomUUID(),
                  assetId: crypto.randomUUID(),
                  name: f.name,
                  buffer,
                  role:
                    requestedRole ??
                    (music.some((m) => m.role === "opening")
                      ? "ending"
                      : "opening"),
                  at: playheadRef.current,
                  gainDb: -12,
                };
                if (requestedRole === "jingle") setJingleSource(clip);
                else setMusic((prev) => [...prev, clip]);
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
          {voiceRunning ? (
            <button
              onClick={() => {
                voiceAbort.current?.abort();
                setNotice(
                  "音質調整を中止しました。元の音声・保存済みの編集内容は変更していません。",
                );
              }}
            >
              音質調整を中止
            </button>
          ) : null}
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
                「不要な部分をカット」の「文字起こし」で、Whisperで文字起こしするか、字幕を読み込みます。Wordやテキストの原稿があれば、話者候補を探せます。原稿は任意です。
              </li>
              <li>
                カット候補を試聴し、残す間や範囲を調整して採用します。原稿にジングルの指定があれば、挿入候補も前後の発言を聞いてから配置できます。
              </li>
              <li>
                声の音量・ノイズを調整し、原音と聞き比べて全体に反映。音楽も追加できます。音声と編集内容の両方を保存してください。
              </li>
            </ol>
            <h3>保存とプライバシー</h3>
            <p>
              音声・字幕・原稿をこの端末で処理します。モデル取得時にHugging
              Face等へ接続します。アプリへのアクセスはGitHub
              Pagesに記録され得ます。モデルはブラウザにキャッシュされる場合があります。
            </p>
            <p>
              編集内容・字幕・原稿・話者の確認結果はこのブラウザに自動保存します（音声本体・操作デモは含みません）。再開時は同じ元音声を選び直してください。共有PCでは他の利用者も内容を参照できる場合があります。「編集を保存」でファイルにも保管してください。
            </p>
            <h3>現在の制限</h3>
            <p>
              PCのChrome /
              Edgeを推奨。長時間・多トラックはメモリを多く使います。声による本人確認、声量に応じたBGMの自動調整は未対応です。原稿照合は似た言葉を手がかりにした候補です。文字起こしや各候補にも誤りがあり得ます。専門用語や人名を確認し、公開前に試聴してください。
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
