import React, { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import homeLogo from "./assets/OsitoLogoSmall.png";

const STORAGE_KEYS = {
  language: "ositolingo:last-language",
  level: "ositolingo:last-level",
  backgroundColor: "ositolingo:background-color",
  textColor: "ositolingo:text-color"
};

const DEFAULT_BACKGROUND_COLOR = "#0B3D0B";
const DEFAULT_TEXT_COLOR = "#F2F5F0";

function getStoredPreference(key) {
  if (typeof window === "undefined") return "";

  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

function setStoredPreference(key, value) {
  if (typeof window === "undefined") return;

  try {
    if (value) {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore storage failures and keep the app usable.
  }
}

function normalizeHexColor(value, fallback = DEFAULT_BACKGROUND_COLOR) {
  const normalized = (value ?? "").toString().trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
}

function sanitizeHexDraft(value) {
  return (value ?? "").toString().replace(/[^#0-9a-fA-F]/g, "").slice(0, 7);
}

function hexToRgb(hex) {
  const normalized = normalizeHexColor(hex).slice(1);
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const clamp = (value) => Math.max(0, Math.min(255, Math.round(value)));
  return `#${[clamp(r), clamp(g), clamp(b)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("")}`;
}

function mixColors(baseHex, targetHex, amount) {
  const base = hexToRgb(baseHex);
  const target = hexToRgb(targetHex);

  return rgbToHex({
    r: base.r + (target.r - base.r) * amount,
    g: base.g + (target.g - base.g) * amount,
    b: base.b + (target.b - base.b) * amount
  });
}

function buildThemeColors(backgroundHex, textHex) {
  const bg = normalizeHexColor(backgroundHex);
  const text = normalizeHexColor(textHex, DEFAULT_TEXT_COLOR);
  return {
    bg,
    card: mixColors(bg, "#ffffff", 0.08),
    card2: mixColors(bg, "#ffffff", 0.13),
    cardBorder: bg,
    border: mixColors(bg, "#7cff00", 0.22),
    input: mixColors(bg, "#000000", 0.08),
    hover: mixColors(bg, "#ffffff", 0.2),
    text,
    muted: mixColors(text, bg, 0.35)
  };
}

function normalize(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[\u00a1!\u00bf?.,;:()"\\']/g, "")
    .replace(/\s+/g, " ");
}

function isCorrectTyped(userAnswer, ex) {
  const ua = normalize(userAnswer);
  const a0 = normalize(ex.answer);
  if (ua && a0 && ua === a0) return true;

  const alts = (ex.answer_alt ?? "")
    .split("|")
    .map((x) => normalize(x))
    .filter(Boolean);

  return alts.includes(ua);
}

function tokenizeForBank(answer) {
  return (answer ?? "")
    .toString()
    .trim()
    .replace(/[\u00a1!\u00bf?.,;:()"\u201c\u201d]/g, "")
    .replace(/\s+/g, " ")
    .split(" ")
    .filter(Boolean);
}

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function parseExerciseLanguages(exerciseType, fallbackLanguageCode = "en") {
  const parts = (exerciseType ?? "").toString().trim().toLowerCase().split("_");
  if (parts.length === 4 && parts[0] === "translate" && parts[2] === "to") {
    return { from: parts[1], to: parts[3] };
  }

  return { from: "en", to: fallbackLanguageCode };
}

function buildWordBank(correctTokens, ex, distractorsByLanguage, lessonLanguageCode, n = 4) {
  const correctSet = new Set(correctTokens.map((w) => normalize(w)));
  const answerLanguage = parseExerciseLanguages(ex?.exercise_type, lessonLanguageCode).to;
  const pool = distractorsByLanguage?.[answerLanguage] ?? [];

  const candidates = pool.filter((w) => !correctSet.has(normalize(w)));

  return shuffle([...correctTokens, ...shuffle(candidates).slice(0, n)]);
}

function languageToSpeechLocale(languageCode) {
  switch ((languageCode ?? "").toLowerCase()) {
    case "es":
      return "es-ES";
    case "ko":
      return "ko-KR";
    default:
      return "en-US";
  }
}

export default function App() {
  const [languages, setLanguages] = useState([]);
  const [languageCode, setLanguageCode] = useState(() => getStoredPreference(STORAGE_KEYS.language));
  const [themes, setThemes] = useState([]);
  const [themeCode, setThemeCode] = useState("");
  const [lessons, setLessons] = useState([]);
  const [run, setRun] = useState(null);
  const [idx, setIdx] = useState(0);
  const [levelCefr, setLevelCefr] = useState(() => getStoredPreference(STORAGE_KEYS.level));
  const [progress, setProgress] = useState(null);
  const [manualStreakMessage, setManualStreakMessage] = useState(null);
  const [isSavingOutsideWork, setIsSavingOutsideWork] = useState(false);
  const [streakDraft, setStreakDraft] = useState("");
  const [backgroundColor, setBackgroundColor] = useState(() =>
    normalizeHexColor(getStoredPreference(STORAGE_KEYS.backgroundColor))
  );
  const [textColor, setTextColor] = useState(() =>
    normalizeHexColor(getStoredPreference(STORAGE_KEYS.textColor), DEFAULT_TEXT_COLOR)
  );
  const [backgroundColorDraft, setBackgroundColorDraft] = useState(() =>
    normalizeHexColor(getStoredPreference(STORAGE_KEYS.backgroundColor))
  );
  const [textColorDraft, setTextColorDraft] = useState(() =>
    normalizeHexColor(getStoredPreference(STORAGE_KEYS.textColor), DEFAULT_TEXT_COLOR)
  );

  const [typed, setTyped] = useState("");
  const [answerMode, setAnswerMode] = useState("bank");
  const [bankWords, setBankWords] = useState([]);
  const [pickedWords, setPickedWords] = useState([]);
  const [selectedPickedIndex, setSelectedPickedIndex] = useState(null);
  const [feedback, setFeedback] = useState(null);
  const [speechState, setSpeechState] = useState({ supported: true, speaking: false });

  useEffect(() => {
    (async () => {
      const p = await window.progressApi.get();
      setProgress(p);
      setStreakDraft(String(p?.currentStreak ?? 0));
    })();
  }, []);

  useEffect(() => {
    if (!progress) return;
    setStreakDraft(String(progress.currentStreak ?? 0));
  }, [progress]);

  useEffect(() => {
    api.getLanguages().then(setLanguages);
    api.getThemes().then(setThemes);
  }, []);

  useEffect(() => {
    setStoredPreference(STORAGE_KEYS.language, languageCode);
  }, [languageCode]);

  useEffect(() => {
    setStoredPreference(STORAGE_KEYS.level, levelCefr);
  }, [levelCefr]);

  useEffect(() => {
    const nextColor = normalizeHexColor(backgroundColor);
    const nextTextColor = normalizeHexColor(textColor, DEFAULT_TEXT_COLOR);
    setStoredPreference(
      STORAGE_KEYS.backgroundColor,
      nextColor === DEFAULT_BACKGROUND_COLOR ? "" : nextColor
    );
    setStoredPreference(
      STORAGE_KEYS.textColor,
      nextTextColor === DEFAULT_TEXT_COLOR ? "" : nextTextColor
    );

    if (typeof document !== "undefined") {
      const themeColors = buildThemeColors(nextColor, nextTextColor);
      document.documentElement.style.setProperty("--bg", themeColors.bg);
      document.documentElement.style.setProperty("--card", themeColors.card);
      document.documentElement.style.setProperty("--card2", themeColors.card2);
      document.documentElement.style.setProperty("--card-border", themeColors.cardBorder);
      document.documentElement.style.setProperty("--border", themeColors.border);
      document.documentElement.style.setProperty("--input-bg", themeColors.input);
      document.documentElement.style.setProperty("--hover", themeColors.hover);
      document.documentElement.style.setProperty("--text", themeColors.text);
      document.documentElement.style.setProperty("--muted", themeColors.muted);
      document.documentElement.style.setProperty("--accent2", themeColors.text);
    }
  }, [backgroundColor, textColor]);

  useEffect(() => {
    setBackgroundColorDraft(normalizeHexColor(backgroundColor));
  }, [backgroundColor]);

  useEffect(() => {
    setTextColorDraft(normalizeHexColor(textColor, DEFAULT_TEXT_COLOR));
  }, [textColor]);

  useEffect(() => {
    if (!themeCode) {
      setLessons([]);
      return;
    }
    api.getLessonsByTheme(themeCode).then(setLessons);
  }, [themeCode]);

  const cefrLevels = useMemo(() => {
    const order = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
    const scopedThemes = languageCode
      ? (themes ?? []).filter((t) => (t.language_code ?? "").trim() === languageCode)
      : [];
    const set = new Set(
      scopedThemes
        .map((t) => (t.level_cefr ?? "").trim())
        .filter(Boolean)
    );
    return [...set].sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99) || a.localeCompare(b));
  }, [languageCode, themes]);

  const filteredThemes = useMemo(() => {
    const list = languageCode
      ? (themes ?? []).filter((t) => (t.language_code ?? "").trim() === languageCode)
      : [];
    const filtered = levelCefr
      ? list.filter((t) => (t.level_cefr ?? "").trim() === levelCefr)
      : list;

    return [...filtered].sort((a, b) =>
      (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" })
    );
  }, [themes, languageCode, levelCefr]);

  const selectedLanguage = useMemo(() => {
    if (!languageCode) return null;
    return languages.find((language) => language.language_code === languageCode) ?? null;
  }, [languages, languageCode]);

  const selectedTheme = useMemo(() => {
    if (!themeCode) return null;
    return themes.find((t) => t.theme_code === themeCode) ?? null;
  }, [themes, themeCode]);

  const ex = useMemo(() => {
    if (!run?.exercises?.length) return null;
    return run.exercises[idx] ?? null;
  }, [run, idx]);

  const builtAnswer = useMemo(() => pickedWords.join(" "), [pickedWords]);

  useEffect(() => {
    if (!languages.length) return;

    const isValidLanguage = languages.some((language) => language.language_code === languageCode);
    if (!isValidLanguage && languageCode) {
      setLanguageCode("");
    }
  }, [languages, languageCode]);

  useEffect(() => {
    if (!languageCode || !cefrLevels.length) {
      if (levelCefr && !languageCode) {
        setLevelCefr("");
      }
      return;
    }

    if (levelCefr && !cefrLevels.includes(levelCefr)) {
      setLevelCefr("");
    }
  }, [languageCode, cefrLevels, levelCefr]);

  useEffect(() => {
    setFeedback(null);
    setTyped("");
    setPickedWords([]);
    setSelectedPickedIndex(null);

    if (!ex) {
      setBankWords([]);
      return;
    }

    const tokens = tokenizeForBank(ex.answer);

    if (tokens.length) {
      setBankWords(
        buildWordBank(tokens, ex, run?.distractors, run?.lesson?.language_code, 4)
      );
    } else {
      setBankWords([]);
    }

    if (ex.exercise_type !== "mcq") {
      setAnswerMode(tokens.length ? "bank" : "type");
    }
  }, [ex, run]);

  async function startLesson(lessonCode) {
    const res = await api.getLessonRun(lessonCode);
    setRun(res);
    setIdx(0);
    setTyped("");
    setFeedback(null);
    setPickedWords([]);
    setSelectedPickedIndex(null);
    setAnswerMode("bank");
  }

  function backToLessons() {
    setRun(null);
    setIdx(0);
    setTyped("");
    setFeedback(null);
    setPickedWords([]);
    setSelectedPickedIndex(null);
    setAnswerMode("bank");
    setBankWords([]);
  }

  function onLevelChange(e) {
    const v = e.target.value;
    setLevelCefr(v);
    setThemeCode("");
    setLessons([]);
    backToLessons();
  }

  function onLanguageChange(e) {
    const code = e.target.value;
    setLanguageCode(code);
    setLevelCefr("");
    setThemeCode("");
    setLessons([]);
    setManualStreakMessage(null);
    backToLessons();
  }

  async function submitTyped() {
    if (!ex) return;

    const userAnswer =
      ex.exercise_type === "mcq"
        ? ""
        : answerMode === "bank"
        ? builtAnswer
        : typed;

    const ok = isCorrectTyped(userAnswer, ex);

    setFeedback({
      ok,
      msg: ok ? "Correct." : `TRY AGAIN. Expected: ${ex.answer ?? "(no answer)"}`
    });
  }

  async function choose(choice) {
    if (!ex) return;
    const ok = !!choice.is_correct;

    setFeedback({
      ok,
      msg: ok ? "Correct." : `TRY AGAIN. Correct: ${ex.answer ?? "(see choices)"}`
    });
  }

  async function next() {
    const total = run?.exercises?.length ?? 0;
    if (!total || !ex || !feedback) return;

    if (!feedback.ok) return;

    if (idx < total - 1) {
      setIdx((i) => i + 1);
      return;
    }

    const lessonId = run?.lesson?.lesson_code;
    const updated = await window.progressApi.completeLesson(lessonId);
    setProgress(updated);
    setManualStreakMessage(null);
    backToLessons();
  }

  async function markOutsideWorkYesterday() {
    setIsSavingOutsideWork(true);
    try {
      const updated = await window.progressApi.setCurrentStreak(streakDraft);
      setProgress(updated);
      setManualStreakMessage(
        `Current streak set to ${updated?.currentStreak ?? 0}. Longest streak stays at ${updated?.longestStreak ?? 0}.`
      );
    } finally {
      setIsSavingOutsideWork(false);
    }
  }

  function prev() {
    setIdx((i) => Math.max(i - 1, 0));
  }

  function pickWord(w) {
    setPickedWords((p) => {
      const next = [...p, w];
      setSelectedPickedIndex(next.length - 1);
      return next;
    });

    setBankWords((b) => {
      const i = b.indexOf(w);
      if (i === -1) return b;
      const copy = [...b];
      copy.splice(i, 1);
      return copy;
    });
  }

  function unpickWordAt(i) {
    setPickedWords((p) => {
      if (i < 0 || i >= p.length) return p;
      const w = p[i];
      setBankWords((b) => [...b, w]);
      const copy = [...p];
      copy.splice(i, 1);
      return copy;
    });

    setSelectedPickedIndex((current) => {
      if (current === null) return null;
      if (current === i) return null;
      if (current > i) return current - 1;
      return current;
    });
  }

  function movePickedWord(direction) {
    if (selectedPickedIndex === null) return;

    setPickedWords((p) => {
      const nextIndex = selectedPickedIndex + direction;
      if (nextIndex < 0 || nextIndex >= p.length) {
        return p;
      }

      const copy = [...p];
      const [word] = copy.splice(selectedPickedIndex, 1);
      copy.splice(nextIndex, 0, word);
      return copy;
    });

    setSelectedPickedIndex((current) => {
      if (current === null) return null;
      const nextIndex = current + direction;
      return nextIndex < 0 ? 0 : nextIndex;
    });
  }

  function resetBank() {
    setPickedWords([]);
    setSelectedPickedIndex(null);
    const tokens = tokenizeForBank(ex?.answer);
    setBankWords(
      tokens.length
        ? buildWordBank(tokens, ex, run?.distractors, run?.lesson?.language_code, 4)
        : []
    );
    setFeedback(null);
  }

  function onThemeChange(e) {
    const code = e.target.value;
    setThemeCode(code);
    setLessons([]);
    backToLessons();
  }

  function speakText(text, languageCode) {
    const content = (text ?? "").toString().trim();
    if (!content) return;

    if (typeof window === "undefined" || !("speechSynthesis" in window) || typeof SpeechSynthesisUtterance === "undefined") {
      setSpeechState({ supported: false, speaking: false });
      return;
    }

    window.speechSynthesis.cancel();

    const utterance = new SpeechSynthesisUtterance(content);
    utterance.lang = languageToSpeechLocale(languageCode);
    utterance.rate = 0.6;
    utterance.onstart = () => setSpeechState({ supported: true, speaking: true });
    utterance.onend = () => setSpeechState({ supported: true, speaking: false });
    utterance.onerror = () => setSpeechState({ supported: true, speaking: false });

    setSpeechState({ supported: true, speaking: true });
    window.speechSynthesis.speak(utterance);
  }

  function resetAppearanceColors() {
    setBackgroundColor(DEFAULT_BACKGROUND_COLOR);
    setTextColor(DEFAULT_TEXT_COLOR);
  }

  function commitBackgroundColorDraft() {
    setBackgroundColor(normalizeHexColor(backgroundColorDraft));
  }

  function commitTextColorDraft() {
    setTextColor(normalizeHexColor(textColorDraft, DEFAULT_TEXT_COLOR));
  }

  if (run?.lesson) {
    const total = run.exercises.length;
    const answerLanguage = parseExerciseLanguages(ex?.exercise_type, run.lesson.language_code).to;

    return (
      <div className="container grid">
        <div className="card grid">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <div>
              <div className="h1">{run.lesson.title}</div>
              <div className="muted">{run.lesson.instructions}</div>
            </div>
            <button className="choice" onClick={backToLessons} style={{ width: 180 }}>
              Back to lessons
            </button>
          </div>

          <div className="muted">
            Exercise {idx + 1} / {total} - {ex?.exercise_type}
          </div>
        </div>

        {ex && (
          <div className="card grid">
            <div className="row" style={{ justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ fontSize: 24, fontWeight: 650, flex: 1 }}>{ex.prompt}</div>
            </div>

            {ex.exercise_type === "mcq" ? (
              <div className="grid">
                {(ex.choices ?? []).map((c, i) => (
                  <button
                    key={c.choice_id ?? `${c.choice_text ?? "choice"}-${i}`}
                    className="choice"
                    onClick={() => choose(c)}
                  >
                    {c.choice_text}
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid">
                <div className="row">
                  <button
                    className="choice"
                    style={{ width: 140, opacity: answerMode === "bank" ? 1 : 0.7 }}
                    onClick={() => setAnswerMode("bank")}
                    disabled={bankWords.length === 0 && pickedWords.length === 0}
                  >
                    Word bank
                  </button>
                  <button
                    className="choice"
                    style={{ width: 140, opacity: answerMode === "type" ? 1 : 0.7 }}
                    onClick={() => setAnswerMode("type")}
                  >
                    Type
                  </button>

                  <div className="muted" style={{ marginLeft: "auto" }}>
                    (Select a chosen word, then use the move buttons.)
                  </div>
                </div>

                {answerMode === "bank" && (bankWords.length > 0 || pickedWords.length > 0) ? (
                  <div className="grid">
                    <div className="card" style={{ padding: 12, background: "var(--card2)" }}>
                      <div className="muted" style={{ marginBottom: 8 }}>
                        Your answer
                      </div>
                      <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                        <div className="muted">
                          {selectedPickedIndex === null
                            ? "\u00a0"
                            : `Selected: ${pickedWords[selectedPickedIndex]}`}
                        </div>
                        <div className="row answer-toolbar">
                          <button
                            className="choice toolbar-button"
                            onClick={() => movePickedWord(-1)}
                            disabled={selectedPickedIndex === null || selectedPickedIndex === 0}
                          >
                            Move left
                          </button>
                          <button
                            className="choice toolbar-button"
                            onClick={() => movePickedWord(1)}
                            disabled={
                              selectedPickedIndex === null ||
                              selectedPickedIndex === pickedWords.length - 1
                            }
                          >
                            Move right
                          </button>
                          <button
                            className="choice toolbar-button"
                            onClick={() => {
                              if (selectedPickedIndex !== null) {
                                unpickWordAt(selectedPickedIndex);
                              }
                            }}
                            disabled={selectedPickedIndex === null}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                      <div className="row" style={{ flexWrap: "wrap" }}>
                        {pickedWords.length === 0 ? (
                          <div className="muted">Click words below to build the sentence...</div>
                        ) : (
                          pickedWords.map((w, i) => (
                            <button
                              key={`${w}-${i}`}
                              className={i === selectedPickedIndex ? "choice selected" : "choice"}
                              style={{ width: "auto", fontSize: 24 }}
                              onClick={() => setSelectedPickedIndex((current) => current === i ? null : i)}
                              title="Select this word"
                            >
                              {w}
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="card" style={{ padding: 12, background: "var(--card2)" }}>
                      <div className="muted" style={{ marginBottom: 8 }}>
                        Word bank
                      </div>
                      <div className="row" style={{ flexWrap: "wrap" }}>
                        {bankWords.map((w, i) => (
                          <button
                            key={`${w}-${i}`}
                            className="choice"
                            style={{ width: "auto", fontSize: 24 }}
                            onClick={() => pickWord(w)}
                          >
                            {w}
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <button className="choice" onClick={resetBank} style={{ width: 160 }}>
                        Reset words
                      </button>
                      <button className="choice" onClick={submitTyped} style={{ width: 160 }}>
                        Submit
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="grid">
                    <input
                      className="input"
                      value={typed}
                      onChange={(e) => setTyped(e.target.value)}
                      placeholder="Type your answer..."
                      onKeyDown={(e) => {
                        if (e.key === "Enter") submitTyped();
                      }}
                    />
                    <button className="choice" onClick={submitTyped}>
                      Submit
                    </button>
                  </div>
                )}
              </div>
            )}

            {feedback && (
              <div className={feedback.ok ? "ok" : "bad"}>
                {feedback.msg}
                {ex.answer ? (
                  <div style={{ marginTop: 10 }}>
                    <button
                      className="choice speech-button"
                      onClick={() => speakText(ex.answer, answerLanguage)}
                      disabled={!speechState.supported}
                      title="Read the answer aloud"
                    >
                      Hear answer
                    </button>
                  </div>
                ) : null}
                {ex.explanation ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {ex.explanation}
                  </div>
                ) : null}
              </div>
            )}
            {!speechState.supported && (
              <div className="muted">Read aloud is not available on this device.</div>
            )}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button className="choice" onClick={prev} style={{ width: 140 }} disabled={idx === 0}>
                Previous
              </button>
              <button
                className="choice"
                onClick={next}
                style={{ width: 140 }}
                disabled={!feedback?.ok}
              >
                {idx === total - 1 ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="container grid">
      <div className="app-shell">
        <div className="grid main-panel">
          <div className="card hero-card" style={{ justifyItems: "center", textAlign: "center" }}>
            <img
              src={homeLogo}
              alt="OsitoLingo"
              style={{ width: 120, height: "auto", marginBottom: 12 }}
            />
            <div className="h1">OsitoLingo</div>
            <div className="muted">Pick a language, then level, theme, and lesson.</div>
          </div>

          <div className="grid home-grid">
            <div className="card grid">
              <div className="h1" style={{ fontSize: 18 }}>
                Language
              </div>

              <select className="input" value={languageCode} onChange={onLanguageChange}>
                <option value="">- Choose a language -</option>
                {languages.map((language) => (
                  <option key={language.language_code} value={language.language_code}>
                    {language.title}
                    {language.native_title ? ` (${language.native_title})` : ""}
                  </option>
                ))}
              </select>

              <div className="muted">
                {selectedLanguage
                  ? `Learning ${selectedLanguage.title}.`
                  : "Choose which language you want to study."}
              </div>
            </div>

            <div className="card grid">
              <div className="h1" style={{ fontSize: 18 }}>
                CEFR
              </div>

              <select className="input" value={levelCefr} onChange={onLevelChange} disabled={!languageCode}>
                <option value="">- All levels -</option>
                {cefrLevels.map((lvl) => (
                  <option key={lvl} value={lvl}>
                    {lvl}
                  </option>
                ))}
              </select>

              <div className="muted">
                {!languageCode ? "Pick a language first." : "Filter themes by level."}
              </div>
            </div>

            <div className="card grid">
              <div className="h1" style={{ fontSize: 18 }}>
                Themes
              </div>

              <select
                className="input"
                value={themeCode}
                onChange={onThemeChange}
                disabled={!languageCode || filteredThemes.length === 0}
              >
                <option value="">- Choose a theme -</option>
                {filteredThemes.map((t) => (
                  <option key={t.theme_code} value={t.theme_code}>
                    {(t.title ?? "").trim()}
                  </option>
                ))}
              </select>

              {selectedTheme ? (
                <div className="muted">{(selectedTheme.description ?? "").trim()}</div>
              ) : (
                <div className="muted">
                  {!languageCode
                    ? "Select a language first."
                    : filteredThemes.length === 0
                    ? "No themes for this level."
                    : "Select a theme..."}
                </div>
              )}
            </div>

            <div className="card grid lessons-panel">
              <div className="h1" style={{ fontSize: 18 }}>
                Lessons
              </div>

              {!languageCode ? (
                <div className="muted">Select a language...</div>
              ) : !themeCode ? (
                <div className="muted">Select a theme...</div>
              ) : lessons.length === 0 ? (
                <div className="muted">No lessons found for {themeCode}.</div>
              ) : (
                lessons.map((l, i) => {
                  const doneOnce = !!progress?.everCompleted?.[l.lesson_code];
                  return (
                    <button
                      key={l.lesson_code ?? `lesson-${i}`}
                      className="listbtn"
                      onClick={() => startLesson(l.lesson_code)}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <div style={{ fontWeight: 650, flex: 1 }}>{l.title}</div>
                        {doneOnce && <div title="Completed at least once">✓</div>}
                      </div>
                      <div className="muted">{l.instructions ?? ""}</div>
                    </button>
                  );
                })
              )}
            </div>
          </div>
        </div>

        <div className="grid side-panel">
          <div className="card grid">
            <div className="h1" style={{ fontSize: 18 }}>
              Progress
            </div>
            {progress && (
              <>
                <div style={{ fontSize: 18, fontWeight: 700 }}>
                  Streak: {progress.currentStreak}
                </div>
                <div className="muted">
                  Longest: {progress.longestStreak}
                </div>
              </>
            )}
          </div>

          {progress && (
            <div className="card grid streak-card">
              <div className="h1" style={{ fontSize: 18 }}>
                Keep Your Streak
              </div>
              <div className="muted">
                Adjust your current streak directly. Your longest streak will always be preserved.
              </div>
              <input
                className="input"
                type="number"
                min="0"
                step="1"
                value={streakDraft}
                onChange={(e) => setStreakDraft(e.target.value)}
                placeholder="Current streak"
              />
              <button
                className="choice"
                onClick={markOutsideWorkYesterday}
                disabled={isSavingOutsideWork}
              >
                {isSavingOutsideWork ? "Saving..." : "Update current streak"}
              </button>
              {manualStreakMessage && <div className="ok">{manualStreakMessage}</div>}
            </div>
          )}

          <div className="card grid">
            <div className="h1" style={{ fontSize: 18 }}>
              Appearance
            </div>
            <div className="muted">
              Pick the background and text colors for your copy of OsitoLingo.
            </div>
            <div className="row color-controls">
              <input
                className="color-input"
                type="color"
                value={normalizeHexColor(backgroundColor)}
                onChange={(e) => setBackgroundColor(normalizeHexColor(e.target.value))}
                aria-label="Background color"
              />
              <input
                className="input color-value"
                type="text"
                inputMode="text"
                spellCheck="false"
                value={backgroundColorDraft}
                onChange={(e) => setBackgroundColorDraft(sanitizeHexDraft(e.target.value))}
                onBlur={commitBackgroundColorDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitBackgroundColorDraft();
                  }
                }}
                aria-label="Background color hex code"
              />
            </div>
            <div className="row color-controls">
              <input
                className="color-input"
                type="color"
                value={normalizeHexColor(textColor, DEFAULT_TEXT_COLOR)}
                onChange={(e) => setTextColor(normalizeHexColor(e.target.value, DEFAULT_TEXT_COLOR))}
                aria-label="Text color"
              />
              <input
                className="input color-value"
                type="text"
                inputMode="text"
                spellCheck="false"
                value={textColorDraft}
                onChange={(e) => setTextColorDraft(sanitizeHexDraft(e.target.value))}
                onBlur={commitTextColorDraft}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    commitTextColorDraft();
                  }
                }}
                aria-label="Text color hex code"
              />
              <button className="choice color-reset" onClick={resetAppearanceColors}>
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
