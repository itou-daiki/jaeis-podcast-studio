export type VoiceSettings = {
  noise: "off" | "light" | "standard" | "strong";
  rumble: boolean;
  compress: boolean;
};

export const originalVoice: VoiceSettings = {
  noise: "off",
  rumble: false,
  compress: false,
};
export const hasVoiceEffects = (s: VoiceSettings) =>
  s.noise !== "off" || s.rumble || s.compress;
export function isVoiceSettings(value: unknown): value is VoiceSettings {
  if (!value || typeof value !== "object") return false;
  const s = value as VoiceSettings;
  return (
    ["off", "light", "standard", "strong"].includes(s.noise) &&
    typeof s.rumble === "boolean" &&
    typeof s.compress === "boolean"
  );
}
