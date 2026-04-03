// electron/main.js
// JSON-only content loader: reads lesson packs from ../content_packs (dev) or appPath/content_packs (prod)
// and per-language metadata from content_packs/languages/*.json
// Expected per-file shape:
// {
//   "theme": { "theme_code": "...", "title": "...", "sort_order": 10, "is_active": 1, ... },
//   "lesson": { "lesson_code": "...", "theme_code": "...", "title": "...", "sort_order": 10, "is_active": 1, ... },
//   "exercises": [ { "exercise_type": "...", ... }, ... ]
// }

const { app, BrowserWindow, ipcMain, dialog } = require("electron");
const path = require("path");
const fs = require("fs");
const {
  ensureProgressSeeded,
  markLessonCompleted,
  markOutsideAppYesterday,
  setCurrentStreak
} = require("./progressStore");

const isDev = !app.isPackaged;

function createWindow() {
  const win = new BrowserWindow({
    width: 1100,
    height: 800,
    icon: path.join(__dirname, "icon.png"),
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

ipcMain.handle("share:save-png", async (_evt, payload = {}) => {
  const dataUrl = (payload.dataUrl ?? "").toString();
  const defaultFileName = (payload.defaultFileName ?? "ositolingo-streak.png").toString();

  const matches = dataUrl.match(/^data:image\/png;base64,(.+)$/);
  if (!matches) {
    throw new Error("Invalid PNG data.");
  }

  const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0] ?? null;
  const result = await dialog.showSaveDialog(win, {
    title: "Save streak image",
    defaultPath: defaultFileName,
    filters: [{ name: "PNG Image", extensions: ["png"] }]
  });

  if (result.canceled || !result.filePath) {
    return { canceled: true };
  }

  fs.writeFileSync(result.filePath, Buffer.from(matches[1], "base64"));
  return { canceled: false, filePath: result.filePath };
});

function getContentDir() {
  const devDir = path.join(__dirname, "..", "content_packs");
  const prodDir = path.join(app.getAppPath(), "content_packs");

  if (fs.existsSync(devDir)) return devDir;
  return prodDir;
}

function getLanguageDir() {
  return path.join(getContentDir(), "languages");
}

function collectJsonFiles(dir, options = {}) {
  const { excludeDirs = new Set(), excludeFiles = new Set() } = options;

  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      if (!excludeDirs.has(entry.name.toLowerCase())) {
        files.push(...collectJsonFiles(fullPath, options));
      }
      continue;
    }

    if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".json")) continue;
    if (excludeFiles.has(entry.name.toLowerCase())) continue;
    files.push(fullPath);
  }

  return files;
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

function fallbackLanguage(languageCode) {
  const code = (languageCode ?? "es").toString().trim().toLowerCase();

  if (code === "ko") {
    return {
      language_code: "ko",
      title: "Korean",
      native_title: "한국어",
      sort_order: 20,
      is_active: 1
    };
  }

  return {
    language_code: "es",
    title: "Spanish",
    native_title: "Español",
    sort_order: 10,
    is_active: 1
  };
}

function loadLanguageConfigs() {
  const dir = getLanguageDir();
  const languagesByCode = new Map();
  const distractorsByLanguage = new Map();

  if (!fs.existsSync(dir)) {
    const legacySpanish = fallbackLanguage("es");
    languagesByCode.set(legacySpanish.language_code, legacySpanish);
    distractorsByLanguage.set(legacySpanish.language_code, {});
    return { languagesByCode, distractorsByLanguage };
  }

  const files = collectJsonFiles(dir);

  for (const filePath of files) {
    const doc = safeReadJson(filePath);
    const rawLanguage = doc.language ?? {};
    const languageCode = (rawLanguage.language_code ?? "").toString().trim().toLowerCase();

    if (!languageCode) {
      throw new Error(`Missing language.language_code in ${path.basename(filePath)}`);
    }

    const language = {
      ...fallbackLanguage(languageCode),
      ...rawLanguage,
      language_code: languageCode,
      is_active: normalizeBool01(rawLanguage.is_active, 1)
    };

    languagesByCode.set(languageCode, language);
    distractorsByLanguage.set(languageCode, doc.distractors ?? {});
  }

  if (!languagesByCode.has("es")) {
    const legacySpanish = fallbackLanguage("es");
    languagesByCode.set("es", legacySpanish);
    distractorsByLanguage.set("es", {});
  }

  return { languagesByCode, distractorsByLanguage };
}

function loadAllContent() {
  const dir = getContentDir();
  const { languagesByCode, distractorsByLanguage } = loadLanguageConfigs();

  if (!fs.existsSync(dir)) {
    return {
      languages: [],
      themes: [],
      lessonsByTheme: new Map(),
      lessonsByCode: new Map(),
      distractorsByLanguage
    };
  }

  const files = collectJsonFiles(dir, {
    excludeDirs: new Set(["languages"]),
    excludeFiles: new Set(["index.json"])
  });

  const themesByCode = new Map();
  const lessonsByTheme = new Map();
  const lessonsByCode = new Map();
  const activeLanguageCodes = new Set();

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

    const languageCode = (theme.language_code ?? lesson.language_code ?? "es")
      .toString()
      .trim()
      .toLowerCase();
    const language = languagesByCode.get(languageCode) ?? fallbackLanguage(languageCode);

    lesson.theme_code = lesson.theme_code || theme.theme_code;
    lesson.language_code = (lesson.language_code ?? languageCode).toString().trim().toLowerCase();
    theme.is_active = normalizeBool01(theme.is_active, 1);
    lesson.is_active = normalizeBool01(lesson.is_active, 1);
    theme.language_code = language.language_code;
    theme.language_title = theme.language_title || language.title;
    theme.language_native_title = theme.language_native_title || language.native_title;

    if (!themesByCode.has(theme.theme_code)) {
      themesByCode.set(theme.theme_code, theme);
    }

    lessonsByCode.set(lesson.lesson_code, { lesson, exercises });
    activeLanguageCodes.add(language.language_code);

    if (!lessonsByTheme.has(lesson.theme_code)) lessonsByTheme.set(lesson.theme_code, []);
    lessonsByTheme.get(lesson.theme_code).push({
      lesson_code: lesson.lesson_code,
      language_code: lesson.language_code,
      title: lesson.title,
      instructions: lesson.instructions,
      estimated_min: lesson.estimated_min,
      sort_order: lesson.sort_order,
      is_active: lesson.is_active
    });
  }

  const themes = Array.from(themesByCode.values())
    .filter((t) => t.is_active !== 0)
    .sort((a, b) => {
      const ao = a.sort_order ?? 9999;
      const bo = b.sort_order ?? 9999;
      if (ao !== bo) return ao - bo;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });

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

  const languages = Array.from(activeLanguageCodes)
    .map((code) => languagesByCode.get(code) ?? fallbackLanguage(code))
    .filter((language) => language.is_active !== 0)
    .sort((a, b) => {
      const ao = a.sort_order ?? 9999;
      const bo = b.sort_order ?? 9999;
      if (ao !== bo) return ao - bo;
      return (a.title ?? "").localeCompare(b.title ?? "");
    });

  return { languages, themes, lessonsByTheme, lessonsByCode, distractorsByLanguage };
}

ipcMain.handle("content:getLanguages", () => {
  const { languages } = loadAllContent();
  return languages;
});

ipcMain.handle("content:getThemes", () => {
  const { themes } = loadAllContent();
  return themes;
});

ipcMain.handle("progress:get", () => ensureProgressSeeded());
ipcMain.handle("progress:complete", (_evt, lessonCode) => markLessonCompleted(lessonCode));
ipcMain.handle("progress:outside-yesterday", () => markOutsideAppYesterday());
ipcMain.handle("progress:set-current-streak", (_evt, streakValue) => setCurrentStreak(streakValue));

ipcMain.handle("content:getLessonsByTheme", (_evt, themeCode) => {
  const { lessonsByTheme } = loadAllContent();
  return lessonsByTheme.get(themeCode) ?? [];
});

ipcMain.handle("content:getLessonRun", (_evt, lessonCode) => {
  const { lessonsByCode, distractorsByLanguage } = loadAllContent();
  const found = lessonsByCode.get(lessonCode);
  if (!found) return { lesson: null, exercises: [], distractors: {} };

  const { lesson, exercises } = found;

  const exercisesWithIds = exercises.map((e, i) => ({
    exercise_id: `${lesson.lesson_code}:${e.sort_order ?? i + 1}`,
    ...e
  }));

  return {
    lesson: {
      lesson_code: lesson.lesson_code,
      theme_code: lesson.theme_code,
      language_code: lesson.language_code,
      title: lesson.title,
      instructions: lesson.instructions
    },
    exercises: exercisesWithIds,
    distractors: distractorsByLanguage.get(lesson.language_code) ?? {}
  };
});
