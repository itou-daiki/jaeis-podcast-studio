import type { VoiceSettings } from "./voice";
export type Range = { start: number; end: number };
export type Cut = Range & { id: string; reason: string };
export type Segment = Range & { outputStart: number };
export type Track = {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  buffer: AudioBuffer;
  processed?: AudioBuffer;
  voice?: VoiceSettings;
  peaks: Float32Array;
  rms: Float32Array;
  gainDb: number;
  offset: number;
  muted: boolean;
  color: string;
};
export type Cue = Range & {
  text: string;
  // Only imported or manually confirmed names belong in exported subtitles.
  speaker?: string;
  speakerManual?: boolean;
  speakerHint?: { name: string; excerpt: string };
  speakerReview?: "short" | "unmatched" | "ambiguous";
};
export type Candidate = Cut & {
  kind: "silence" | "retake" | "repeat";
  detail: string;
};
export type MusicClip = {
  id: string;
  name: string;
  buffer: AudioBuffer;
  role: "opening" | "ending" | "jingle";
  at: number;
  gainDb: number;
  assetId?: string;
  scriptJingleKey?: string;
};
export type Placement = {
  buffer: AudioBuffer;
  when: number;
  offset: number;
  duration: number;
  gain: number;
  fade: number;
};
