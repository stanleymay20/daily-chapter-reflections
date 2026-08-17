const VOICE_KEY = "bible-study:speech-voice:v1";

const PREFERRED_NAMES = [
  "samantha",
  "daniel",
  "serena",
  "karen",
  "moira",
  "ava",
  "allison",
  "susan",
  "google uk english female",
  "google uk english male",
  "microsoft sonia",
  "microsoft ryan",
  "microsoft aria",
  "microsoft guy",
];

const LOW_QUALITY_HINTS = ["compact", "novelty", "whisper", "zarvox", "bells", "boing"];

export function getEnglishVoices(voices: SpeechSynthesisVoice[]) {
  return voices
    .filter((voice) => /^en(?:-|_)/i.test(voice.lang))
    .sort((a, b) => voiceScore(b) - voiceScore(a) || a.name.localeCompare(b.name));
}

function voiceScore(voice: SpeechSynthesisVoice) {
  const name = voice.name.toLowerCase();
  let score = 0;
  if (/^en-(gb|us|au|ie|za)$/i.test(voice.lang)) score += 20;
  if (voice.localService) score += 8;
  const preferredIndex = PREFERRED_NAMES.findIndex((candidate) => name.includes(candidate));
  if (preferredIndex >= 0) score += 100 - preferredIndex;
  if (/(premium|enhanced|natural|neural)/i.test(name)) score += 40;
  if (LOW_QUALITY_HINTS.some((hint) => name.includes(hint))) score -= 100;
  return score;
}

export function chooseDefaultVoice(voices: SpeechSynthesisVoice[]) {
  return getEnglishVoices(voices)[0];
}

export function loadSpeechVoice() {
  if (typeof window === "undefined") return "";
  try { return localStorage.getItem(VOICE_KEY) || ""; } catch { return ""; }
}

export function saveSpeechVoice(voiceUri: string) {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(VOICE_KEY, voiceUri); } catch { /* local storage may be unavailable */ }
}

export function normalizeSpeechText(text: string) {
  return text
    .replace(/\[[^\]]{1,80}\]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/([.!?;:])(?=[A-Za-z])/g, "$1 ")
    .trim();
}
