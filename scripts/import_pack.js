/* eslint-disable no-console */
const fs = require("fs");
const path = require("path");
const Database = require("better-sqlite3");

function requireString(val, label) {
  if (typeof val !== "string" || !val.trim()) throw new Error(`Missing/invalid ${label}`);
  return val.trim();
}

function toInt01(val, defaultVal = 1) {
  if (val === undefined || val === null) return defaultVal;
  return val ? 1 : 0;
}

function openDb(dbPath) {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  return db;
}

function runImport(db, pack) {
  const theme = pack.theme || {};
  const lesson = pack.lesson || {};
  const exercises = Array.isArray(pack.exercises) ? pack.exercises : [];

  const theme_code = requireString(theme.theme_code, "theme.theme_code");
  const lesson_code = requireString(lesson.lesson_code, "lesson.lesson_code");

  const tx = db.transaction(() => {
    // Upsert THEME
    const upsertTheme = db.prepare(`
      INSERT INTO lesson_theme (theme_code, title, description, level_cefr, sort_order, is_active)
      VALUES (@theme_code, @title, @description, @level_cefr, @sort_order, @is_active)
      ON CONFLICT(theme_code) DO UPDATE SET
        title=excluded.title,
        description=excluded.description,
        level_cefr=excluded.level_cefr,
        sort_order=excluded.sort_order,
        is_active=excluded.is_active
    `);

    upsertTheme.run({
      theme_code,
      title: requireString(theme.title, "theme.title"),
      description: theme.description ?? null,
      level_cefr: theme.level_cefr ?? null,
      sort_order: Number.isInteger(theme.sort_order) ? theme.sort_order : 0,
      is_active: toInt01(theme.is_active, 1)
    });

    const themeRow = db.prepare(`SELECT theme_id FROM lesson_theme WHERE theme_code = ?`).get(theme_code);
    const theme_id = themeRow.theme_id;

    // Upsert LESSON
    const upsertLesson = db.prepare(`
      INSERT INTO lesson (theme_id, lesson_code, title, instructions, estimated_min, sort_order, is_active)
      VALUES (@theme_id, @lesson_code, @title, @instructions, @estimated_min, @sort_order, @is_active)
      ON CONFLICT(lesson_code) DO UPDATE SET
        theme_id=excluded.theme_id,
        title=excluded.title,
        instructions=excluded.instructions,
        estimated_min=excluded.estimated_min,
        sort_order=excluded.sort_order,
        is_active=excluded.is_active
    `);

    upsertLesson.run({
      theme_id,
      lesson_code,
      title: requireString(lesson.title, "lesson.title"),
      instructions: lesson.instructions ?? null,
      estimated_min: Number.isInteger(lesson.estimated_min) ? lesson.estimated_min : null,
      sort_order: Number.isInteger(lesson.sort_order) ? lesson.sort_order : 0,
      is_active: toInt01(lesson.is_active, 1)
    });

    const lessonRow = db.prepare(`SELECT lesson_id FROM lesson WHERE lesson_code = ?`).get(lesson_code);
    const lesson_id = lessonRow.lesson_id;

    // Helpful: clear & replace exercises for this lesson_code each import
    // (Keeps id churn inside one lesson, avoids stale exercises.)
    // If you prefer true upsert-by-content later, we can add exercise_code.
    db.prepare(`
      DELETE FROM exercise_choice
      WHERE exercise_id IN (SELECT exercise_id FROM exercise WHERE lesson_id = ?)
    `).run(lesson_id);

    db.prepare(`DELETE FROM exercise WHERE lesson_id = ?`).run(lesson_id);

    const insertExercise = db.prepare(`
      INSERT INTO exercise
        (lesson_id, exercise_type, prompt, answer, answer_alt, explanation, audio_url, difficulty, sort_order, is_active)
      VALUES
        (@lesson_id, @exercise_type, @prompt, @answer, @answer_alt, @explanation, @audio_url, @difficulty, @sort_order, @is_active)
    `);

    const insertChoice = db.prepare(`
      INSERT INTO exercise_choice (exercise_id, choice_text, is_correct, sort_order)
      VALUES (@exercise_id, @choice_text, @is_correct, @sort_order)
    `);

    for (const ex of exercises) {
      const exercise_type = requireString(ex.exercise_type, "exercise.exercise_type");
      const prompt = requireString(ex.prompt, "exercise.prompt");

      const info = insertExercise.run({
        lesson_id,
        exercise_type,
        prompt,
        answer: ex.answer ?? null,
        answer_alt: ex.answer_alt ?? null,
        explanation: ex.explanation ?? null,
        audio_url: ex.audio_url ?? null,
        difficulty: Number.isInteger(ex.difficulty) ? ex.difficulty : 1,
        sort_order: Number.isInteger(ex.sort_order) ? ex.sort_order : 0,
        is_active: toInt01(ex.is_active, 1)
      });

      const exercise_id = info.lastInsertRowid;

      if (exercise_type === "mcq") {
        const choices = Array.isArray(ex.choices) ? ex.choices : [];
        if (choices.length < 2) throw new Error(`MCQ exercise must have at least 2 choices: "${prompt}"`);

        for (const c of choices) {
          insertChoice.run({
            exercise_id,
            choice_text: requireString(c.choice_text, "choice.choice_text"),
            is_correct: toInt01(c.is_correct, 0),
            sort_order: Number.isInteger(c.sort_order) ? c.sort_order : 0
          });
        }
      }
    }

    return { theme_id, lesson_id, theme_code, lesson_code, exercise_count: exercises.length };
  });

  return tx();
}

function main() {
  const dbPath = process.argv[2];
  const packPath = process.argv[3];

  if (!dbPath || !packPath) {
    console.error("Usage: node scripts/import_pack.js <path/to/app.db> <path/to/pack.json>");
    process.exit(1);
  }

  const absDb = path.resolve(dbPath);
  const absPack = path.resolve(packPath);

  const raw = fs.readFileSync(absPack, "utf8");
  const pack = JSON.parse(raw);

  const db = openDb(absDb);
  try {
    const result = runImport(db, pack);
    console.log("Import complete:", result);
  } finally {
    db.close();
  }
}

main();