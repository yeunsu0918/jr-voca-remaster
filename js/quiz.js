// quiz.js — builds a list of questions from a pool of words.
// Four modes cover recognition, recall, spelling, and listening.

import { WORDS } from "./store.js";

export const MODES = {
  en2ko: { label: "영어 → 뜻", kind: "choice", audio: false },
  ko2en: { label: "뜻 → 영어", kind: "choice", audio: false },
  listen: { label: "듣고 뜻 고르기", kind: "choice", audio: true },
  spell: { label: "스펠링 입력", kind: "input", audio: false },
};

const shuffle = (arr) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// The first Korean sense only, for compact multiple-choice options.
const shortKo = (ko) => ko.split(/[;,]/)[0].trim();

// Pick 3 wrong options for a word, preferring same-day words so the
// distractors feel plausible; fall back to the whole list if needed.
function distractors(word, pool, field) {
  const sameDay = WORDS.filter((w) => w.day === word.day && w.id !== word.id);
  const rest = WORDS.filter((w) => w.day !== word.day);
  const seen = new Set([field === "ko" ? shortKo(word.ko) : word.en.toLowerCase()]);
  const out = [];
  for (const cand of [...shuffle(sameDay), ...shuffle(rest)]) {
    const val = field === "ko" ? shortKo(cand.ko) : cand.en;
    const key = field === "ko" ? val : val.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(field === "ko" ? { text: val } : { text: val });
    if (out.length === 3) break;
  }
  return out;
}

export function buildQuiz(pool, mode, count = 10) {
  const words = shuffle(pool).slice(0, Math.min(count, pool.length));
  return words.map((w) => {
    if (mode === "spell") {
      return { id: w.id, word: w, mode, prompt: w.ko, answer: w.en, audio: false };
    }
    const answerField = mode === "ko2en" ? "en" : "ko";
    const correct = answerField === "en" ? { text: w.en } : { text: shortKo(w.ko) };
    const options = shuffle([correct, ...distractors(w, pool, answerField)]);
    return {
      id: w.id,
      word: w,
      mode,
      prompt: mode === "ko2en" ? w.ko : w.en,
      audio: mode === "listen",
      options,
      correctText: correct.text,
    };
  });
}

// Forgiving spelling check: trim, lowercase, collapse spaces.
export function checkSpelling(input, answer) {
  const norm = (s) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return norm(input) === norm(answer);
}
