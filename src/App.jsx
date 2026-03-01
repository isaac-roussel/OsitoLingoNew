import React, { useEffect, useMemo, useState } from "react";
import { api } from "./api.js";
import homeLogo from "./assets/OsitoLogoSmall.png";
///////////////////

const BANK_DISTRACTORS = [
  "yo", "tú", "él", "ella", "nosotros", "ellos",
  "muy", "también", "aquí", "allí", "hoy", "mañana",
  "sí", "no", "por", "favor", "gracias", "de", "nada",
  "es", "está", "soy", "tengo", "quiero", "puedo",
  "un", "una", "el", "la", "los", "las"
];
  /*return (
    <div style={{ padding: 16 }}>
      <div style={{ fontSize: 24, fontWeight: 700 }}>
        🔥 Streak: {progress.currentStreak}
      </div>
      <div style={{ opacity: 0.8 }}>
        🏆 Longest: {progress.longestStreak}
      </div>
      {progress.lastCompletedDate && (
        <div style={{ marginTop: 8, opacity: 0.7 }}>
          Last completed: {progress.lastCompletedDate}
        </div>
      )}
    </div>
  );
}*/


function normalize(s) {
  return (s ?? "")
    .toString()
    .trim()
    .toLowerCase()
    .replace(/[¡!¿?.,;:()"\\']/g, "")
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

// Tokenize for word bank: split on whitespace.
function tokenizeForBank(answer) {
  // Keep letters (including accents), numbers, and apostrophes if you ever want them.
  // Strip punctuation like . , ! ? ¿ ¡ : ; ( ) " etc.
  return (answer ?? "")
    .toString()
    .trim()
    .replace(/[¡!¿?.,;:()"“”]/g, "")
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

function sampleDistractors(correctTokens, n = 4) {
  const correctSet = new Set(correctTokens.map((w) => normalize(w)));

  const candidates = BANK_DISTRACTORS.filter(
    (w) => !correctSet.has(normalize(w))
  );

  return shuffle(candidates).slice(0, n);
}

export default function App() {
  const [themes, setThemes] = useState([]);
  const [themeCode, setThemeCode] = useState(""); // dropdown selection
  const [lessons, setLessons] = useState([]);
  const [run, setRun] = useState(null); // { lesson, exercises }
  const [idx, setIdx] = useState(0);
  const [levelCefr, setLevelCefr] = useState(""); // "" means All

  const [progress, setProgress] = useState(null);

  useEffect(() => {
    (async () => {
      const p = await window.progressApi.get();
      setProgress(p);
    })();
  }, []);

  // typing mode state
  const [typed, setTyped] = useState("");

  // word bank mode state
  const [answerMode, setAnswerMode] = useState("bank"); // "bank" | "type"
  const [bankWords, setBankWords] = useState([]);
  const [pickedWords, setPickedWords] = useState([]);

  const [feedback, setFeedback] = useState(null); // {ok, msg}

  useEffect(() => {
    api.getThemes().then(setThemes);
  }, []);

  // Load lessons when theme changes
  useEffect(() => {
    if (!themeCode) {
      setLessons([]);
      return;
    }
    api.getLessonsByTheme(themeCode).then(setLessons);
  }, [themeCode]);

const cefrLevels = useMemo(() => {
  const order = { A1: 1, A2: 2, B1: 3, B2: 4, C1: 5, C2: 6 };
  const set = new Set(
    (themes ?? [])
      .map((t) => (t.level_cefr ?? "").trim())
      .filter(Boolean)
  );
  return [...set].sort((a, b) => (order[a] ?? 99) - (order[b] ?? 99) || a.localeCompare(b));
}, [themes]);

const filteredThemes = useMemo(() => {
  const list = themes ?? [];
  const filtered = levelCefr
    ? list.filter((t) => (t.level_cefr ?? "").trim() === levelCefr)
    : list;

  return [...filtered].sort((a, b) =>
    (a.title ?? "").localeCompare(b.title ?? "", undefined, { sensitivity: "base" })
  );
}, [themes, levelCefr]);


  const selectedTheme = useMemo(() => {
    if (!themeCode) return null;
    return themes.find((t) => t.theme_code === themeCode) ?? null;
  }, [themes, themeCode]);

  const ex = useMemo(() => {
    if (!run?.exercises?.length) return null;
    return run.exercises[idx] ?? null;
  }, [run, idx]);

  // Whenever exercise changes, reset input/bank
  useEffect(() => {
    setFeedback(null);
    setTyped("");
    setPickedWords([]);

    if (!ex) {
      setBankWords([]);
      return;
    }

    const tokens = tokenizeForBank(ex.answer);

if (tokens.length) {
  const distractors = sampleDistractors(tokens, 4);
  setBankWords(shuffle([...tokens, ...distractors]));
} else {
  setBankWords([]);
}
    if (ex.exercise_type !== "mcq") {
      setAnswerMode(tokens.length ? "bank" : "type");
    }
  }, [ex]);

  const builtAnswer = useMemo(() => pickedWords.join(" "), [pickedWords]);

  async function startLesson(lessonCode) {
    const res = await api.getLessonRun(lessonCode);
    setRun(res);
    setIdx(0);
    setTyped("");
    setFeedback(null);
    setPickedWords([]);
    setAnswerMode("bank");
  }

  function backToLessons() {
    setRun(null);
    setIdx(0);
    setTyped("");
    setFeedback(null);
    setPickedWords([]);
    setAnswerMode("bank");
    setBankWords([]);
  }

function onLevelChange(e) {
  const v = e.target.value;
  setLevelCefr(v);
  // Reset theme + lessons when level changes
  setThemeCode("");
  setLessons([]);
  backToLessons();
}

  async function submitTyped() {
    if (!ex) return;

    const user_answer =
      ex.exercise_type === "mcq"
        ? ""
        : answerMode === "bank"
        ? builtAnswer
        : typed;

    const ok = isCorrectTyped(user_answer, ex);

    setFeedback({
      ok,
      msg: ok ? "Correct." : `Not quite. Expected: ${ex.answer ?? "(no answer)"}`
    });
  }

  async function choose(choice) {
    if (!ex) return;
    const ok = !!choice.is_correct;

    setFeedback({
      ok,
      msg: ok ? "Correct." : `Not quite. Correct: ${ex.answer ?? "(see choices)"}`
    });
  }

  async function next() {
    const total = run?.exercises?.length ?? 0;
    if (!total) return;

    if (idx < total - 1) {
      setIdx((i) => i + 1);
      return;
    }

    // ✅ last question → lesson completed (pass lesson_code through to progress store)
    const lessonId = run?.lesson?.lesson_code;
    const updated = await window.progressApi.completeLesson(lessonId);
    setProgress(updated);

    backToLessons();
  }

  function prev() {
    setIdx((i) => Math.max(i - 1, 0));
  }

  // Word bank actions
  function pickWord(w) {
    setPickedWords((p) => [...p, w]);
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
      setBankWords((b) => [...b, w]); // return word to bank (append to end)
      const copy = [...p];
      copy.splice(i, 1);
      return copy;
    });
  }

  function resetBank() {
    setPickedWords([]);
    const tokens = tokenizeForBank(ex?.answer);
    setBankWords(tokens.length ? shuffle(tokens) : []);
    setFeedback(null);
  }

  function onThemeChange(e) {
    const code = e.target.value;
    setThemeCode(code);
    // reset anything theme-specific
    setLessons([]);
    backToLessons();
  }

  // ----------------------------
  // Lesson run view
  // ----------------------------
  if (run?.lesson) {
    const total = run.exercises.length;

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
            Exercise {idx + 1} / {total} • {ex?.exercise_type}
          </div>
        </div>

        {ex && (
          <div className="card grid">
            <div style={{ fontSize: 18, fontWeight: 650 }}>{ex.prompt}</div>

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
                {/* Mode toggle */}
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
                    (Click chosen words to remove)
                  </div>
                </div>

                {answerMode === "bank" && (bankWords.length > 0 || pickedWords.length > 0) ? (
                  <div className="grid">
                    {/* Answer bar */}
                    <div className="card" style={{ padding: 12, background: "var(--card2)" }}>
                      <div className="muted" style={{ marginBottom: 8 }}>
                        Your answer
                      </div>
                      <div className="row" style={{ flexWrap: "wrap" }}>
                        {pickedWords.length === 0 ? (
                          <div className="muted">Click words below to build the sentence…</div>
                        ) : (
                          pickedWords.map((w, i) => (
                            <button
                              key={`${w}-${i}`}
                              className="choice"
                              style={{ width: "auto" }}
                              onClick={() => unpickWordAt(i)}
                              title="Remove"
                            >
                              {w}
                            </button>
                          ))
                        )}
                      </div>
                    </div>

                    {/* Bank */}
                    <div className="card" style={{ padding: 12, background: "var(--card2)" }}>
                      <div className="muted" style={{ marginBottom: 8 }}>
                        Word bank
                      </div>
                      <div className="row" style={{ flexWrap: "wrap" }}>
                        {bankWords.map((w, i) => (
                          <button
                            key={`${w}-${i}`}
                            className="choice"
                            style={{ width: "auto" }}
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
                      placeholder="Type your answer…"
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
                {ex.explanation ? (
                  <div className="muted" style={{ marginTop: 6 }}>
                    {ex.explanation}
                  </div>
                ) : null}
              </div>
            )}

            <div className="row" style={{ justifyContent: "space-between" }}>
              <button className="choice" onClick={prev} style={{ width: 140 }} disabled={idx === 0}>
                Previous
              </button>
              <button className="choice" onClick={next} style={{ width: 140 }}>
                {idx === total - 1 ? "Finish" : "Next"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  // ----------------------------
  // Theme / lesson picker view
  // ----------------------------
  return (
    <div className="container grid">
      <div className="card grid" style={{ justifyItems: "center", textAlign: "center" }}>
        <img
          src={homeLogo}
          alt="OsitoLingo"
          style={{ width: 120, height: "auto", marginBottom: 12 }}
        />
        <div className="h1">OsitoLingo</div>
        <div className="muted">Pick a CEFR level, a theme, then start a lesson.</div>

        {progress && (
          <div style={{ marginTop: 16 }}>
            <div style={{ fontSize: 18, fontWeight: 700 }}>
              🔥 Streak: {progress.currentStreak}
            </div>
            <div style={{ opacity: 0.8 }}>
              🏆 Longest: {progress.longestStreak}
            </div>
          </div>
        )}
      </div>
<div
  className="grid"
  style={{
    gridTemplateColumns: "220px 1fr 1fr",
    alignItems: "start",
    gap: 16
  }}
>
  {/* CEFR */}
  <div className="card grid">
    <div className="h1" style={{ fontSize: 18 }}>
      CEFR
    </div>

    <select className="input" value={levelCefr} onChange={onLevelChange}>
      <option value="">— All levels —</option>
      {cefrLevels.map((lvl) => (
        <option key={lvl} value={lvl}>
          {lvl}
        </option>
      ))}
    </select>

    <div className="muted">
      Filter themes by level.
    </div>
  </div>

  {/* Themes */}
  <div className="card grid">
    <div className="h1" style={{ fontSize: 18 }}>
      Themes
    </div>

    <select className="input" value={themeCode} onChange={onThemeChange} disabled={filteredThemes.length === 0}>
      <option value="">— Choose a theme —</option>
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
        {filteredThemes.length === 0
          ? "No themes for this level."
          : "Select a theme…"}
      </div>
    )}
  </div>

  {/* Lessons */}
  <div className="card grid" style={{ maxHeight: 520, overflowY: "auto" }}>
    <div className="h1" style={{ fontSize: 18 }}>
      Lessons
    </div>

    {!themeCode ? (
      <div className="muted">Select a theme…</div>
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
              {doneOnce && <div title="Completed at least once">✔</div>}
            </div>
            <div className="muted">{l.instructions ?? ""}</div>
          </button>
        );
      })
    )}
  </div>
</div>
      
    </div>
  );
}
