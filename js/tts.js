// tts.js — English pronunciation via the browser's built-in speech synthesis.
// Works offline on most devices; degrades silently where unsupported.

let cachedVoice = null;

const synth = typeof window !== "undefined" ? window.speechSynthesis : null;

export const ttsSupported = () => !!synth;

function pickVoice() {
  if (!synth) return null;
  if (cachedVoice) return cachedVoice;
  const voices = synth.getVoices();
  if (!voices.length) return null;
  // Prefer a US English voice, then any English, then whatever exists.
  cachedVoice =
    voices.find((v) => /en[-_]US/i.test(v.lang)) ||
    voices.find((v) => /^en/i.test(v.lang)) ||
    voices[0];
  return cachedVoice;
}

// Voices load asynchronously on some browsers.
if (synth) synth.onvoiceschanged = () => (cachedVoice = null);

export function speak(text, rate = 0.85) {
  if (!synth || !text) return;
  try {
    synth.cancel(); // stop any overlap so rapid taps stay crisp
    const u = new SpeechSynthesisUtterance(text);
    u.lang = "en-US";
    u.rate = Math.max(0.5, Math.min(1.2, rate));
    const v = pickVoice();
    if (v) u.voice = v;
    synth.speak(u);
  } catch {
    /* ignore — pronunciation is a nice-to-have */
  }
}
