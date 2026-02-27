// electron/main.js
// JSON-only content loader: reads ALL *.json files in ../content_packs (dev) or appPath/content_packs (prod)
// Expected per-file shape:
// {
//   "theme": { "theme_code": "...", "title": "...", "sort_order": 10, "is_active": 1, ... },
//   "lesson": { "lesson_code": "...", "theme_code": "...", "title": "...", "sort_order": 10, "is_active": 1, ... },
//   "exercises": [ { "exercise_type": "...", ... }, ... ]
// }

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const { ensureProgressSeeded, markLessonCompleted } = require("./progressStore");

const isDev = !app.isPackaged;


// -----------------------------
// Window
// -----------------------------
function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  if (isDev) {
  win.loadURL("http://localhost:5173");
  win.webContents.openDevTools({ mode: "detach" });
} else {
  win.loadFile(path.join(__dirname, "..", "dist", "index.html"));
}
}

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// -----------------------------
// Content loading
// -----------------------------
function getContentDir() {
  // dev: project/content_packs
  const devDir = path.join(__dirname, "..", "content_packs");
  // prod: <appPath>/content_packs (you may adjust depending on packaging strategy)
  const prodDir = path.join(app.getAppPath(), "content_packs");

  if (fs.existsSync(devDir)) return devDir;
  return prodDir;
}

function safeReadJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf-8");
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`Invalid JSON in ${path.basename(filePath)}: ${e.message}`);
  }
}

function normalizeBool01(v, defaultVal = 1) {
  if (v === undefined || v === null) return defaultVal;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return v ? 1 : 0;
  if (typeof v === "string") return v === "1" || v.toLowerCase() === "true" ? 1 : 0;
  return defaultVal;
}

/**
 * Loads all JSON files and builds in-memory indexes.
 * Returns:
 *  {
 *    themes: [theme...],
 *    lessonsByTheme: Map(theme_code -> [lessonSummary...]),
 *    lessonsByCode: Map(lesson_code -> { lesson, exercises }),
 *  }
 */
function loadAllContent() {
  const dir = getContentDir();

  if (!fs.existsSync(dir)) {
    return {
      themes: [],
      lessonsByTheme: new Map(),
      lessonsByCode: new Map()
    };
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".json"))
    // Skip index.json if you still have one lying around
    .filter((f) => f.toLowerCase() !== "index.json")
    .map((f) => path.join(dir, f));

  const themesByCode = new Map();   // theme_code -> theme
  const lessonsByTheme = new Map(); // theme_code -> [lessonSummary]
  const lessonsByCode = new Map();  // lesson_code -> { lesson, exercises }

  for (const filePath of files) {
    const f = path.basename(filePath);
    const doc = safeReadJson(filePath);

    const theme = doc.theme;
    const lesson = doc.lesson;
    const exercises = Array.isArray(doc.exercises) ? doc.exercises : [];

    if (!theme?.theme_code) {
      throw new Error(`Missing theme.theme_code in ${f}`);
    }
    if (!lesson?.lesson_code) {
      throw new Error(`Missing lesson.lesson_code in ${f}`);
    }

    // Ensure lesson has theme_code (lesson wins, else inherit from theme)
    lesson.theme_code = lesson.theme_code || theme.theme_code;

    // Normalize actives
    theme.is_active = normalizeBool01(theme.is_active, 1);
    lesson.is_active = normalizeBool01(lesson.is_active, 1);

    // Dedupe themes by theme_code (first wins). If you prefer last-wins, swap the if for unconditional set().
    if (!themesByCode.has(theme.theme_code)) {
      themesByCode.set(theme.theme_code, theme);
    }

    // Index lesson run by lesson_code
    lessonsByCode.set(lesson.lesson_code, { lesson, exercises });

    // Add lesson summary under its theme
    if (!lessonsByTheme.has(lesson.theme_code)) lessonsByTheme.set(lesson.theme_code, []);
    lessonsByTheme.get(lesson.theme_code).push({
      lesson_code: lesson.lesson_code,
      title: lesson.title,
      instructions: lesson.instructions,
      estimated_min: lesson.estimated_min,
      sort_order: lesson.sort_order,
      is_active: lesson.is_active
    });
  }

  // Sort themes
  const themes = Array.from(themesByCode.values())
    .filter((t) => t.is_active !== 0)
    .sort((a, b) => {
      const ao = a.sort_order ?? 9999;
      const bo = b.sort_order ?? 9999;
      if (ao !== bo) return ao - bo;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });

  // Sort & filter lessons per theme
  for (const [tc, arr] of lessonsByTheme.entries()) {
    const sorted = arr
      .filter((l) => l.is_active !== 0)
      .sort((a, b) => {
        const ao = a.sort_order ?? 9999;
        const bo = b.sort_order ?? 9999;
        if (ao !== bo) return ao - bo;
        return (a.title ?? "").localeCompare(b.title ?? "");
      });
    lessonsByTheme.set(tc, sorted);
  }

  return { themes, lessonsByTheme, lessonsByCode };
}



// -----------------------------
// IPC API
// -----------------------------
ipcMain.handle("content:getThemes", () => {
  const { themes } = loadAllContent();
  return themes;
});
//import { ipcMain } from "electron";
//import { ensureProgressSeeded, markLessonCompleted } from "./progressStore.js";

ipcMain.handle("progress:get", () => ensureProgressSeeded());
ipcMain.handle("progress:complete", (_evt, lessonCode) => markLessonCompleted(lessonCode));
ipcMain.handle("progress:seed", (_evt, seedValue) => {
  return seedProgress(seedValue);
});


ipcMain.handle("content:getLessonsByTheme", (_evt, themeCode) => {
  const { lessonsByTheme } = loadAllContent();
  return lessonsByTheme.get(themeCode) ?? [];
});

ipcMain.handle("content:getLessonRun", (_evt, lessonCode) => {
  const { lessonsByCode } = loadAllContent();
  const found = lessonsByCode.get(lessonCode);
  if (!found) return { lesson: null, exercises: [] };

  const { lesson, exercises } = found;

  // Provide stable exercise_id for UI keys (generated)
  const exercisesWithIds = exercises.map((e, i) => ({
    exercise_id: `${lesson.lesson_code}:${e.sort_order ?? (i + 1)}`,
    ...e
  }));

  return {
    lesson: {
      lesson_code: lesson.lesson_code,
      theme_code: lesson.theme_code,
      title: lesson.title,
      instructions: lesson.instructions
    },
    exercises: exercisesWithIds
  };
});