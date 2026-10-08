// Original, deterministic synthesis: no recordings, samples or external models.
// Keep v1 unchanged so projects containing studio-calm-v1 remain reproducible.
export function createCalmLoop(context: BaseAudioContext): AudioBuffer {
  const rate = context.sampleRate;
  const buffer = context.createBuffer(1, rate * 16, rate);
  const data = buffer.getChannelData(0);
  const note = (
    midi: number,
    start: number,
    seconds: number,
    volume: number,
    pad = false,
  ) => {
    const frequency = 440 * 2 ** ((midi - 69) / 12);
    const from = Math.round(start * rate),
      count = Math.round(seconds * rate);
    for (let i = 0; i < count && from + i < data.length; i++) {
      const t = i / rate;
      const attack = Math.min(1, t / (pad ? 0.5 : 0.025));
      const release = Math.min(1, (seconds - t) / (pad ? 0.8 : 0.35));
      const envelope = attack * release * (pad ? 1 : Math.exp(-2.8 * t));
      const phase = 2 * Math.PI * frequency * t;
      data[from + i] +=
        volume * envelope * (Math.sin(phase) + 0.15 * Math.sin(phase * 2));
    }
  };
  const chords = [
    [48, 55, 59, 62],
    [45, 52, 55, 59],
    [41, 48, 52, 57],
    [43, 50, 53, 57],
  ];
  chords.forEach((chord, bar) => {
    chord.forEach((midi) => note(midi, bar * 4, 3.9, 0.12, true));
    [0, 2, 1, 3].forEach((index, beat) =>
      note(chord[index] + 12, bar * 4 + beat * 0.85 + 0.2, 1, 0.1),
    );
  });
  // All tails end before the loop edge. A bounded peak keeps gain predictable.
  let peak = 0;
  for (const sample of data) peak = Math.max(peak, Math.abs(sample));
  if (peak > 0) for (let i = 0; i < data.length; i++) data[i] *= 0.7 / peak;
  return buffer;
}
