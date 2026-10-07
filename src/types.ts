export type Range = { start: number; end: number };
export type Cut = Range & { id: string; reason: string };
export type Segment = Range & { outputStart: number };
export type Track = {
  id: string;
  name: string;
  size: number;
  lastModified: number;
  buffer: AudioBuffer;
  peaks: Float32Array;
  rms: Float32Array;
  gainDb: number;
  offset: number;
  muted: boolean;
  color: string;
};
export type Cue = Range & { text: string; speaker?: string };
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
};
export type Placement = {
  buffer: AudioBuffer;
  when: number;
  offset: number;
  duration: number;
  gain: number;
  fade: number;
};
