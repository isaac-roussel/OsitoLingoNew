// electron/progressStore.js
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

const DEFAULT_SEED_STREAK = 1683;

function progressPath() {
  return path.join(app.getPath("userData"), "progress.json");
}

// YYYY-MM-DD in the device's local timezone
function todayLocalISO() {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

function addDaysISO(iso, days) {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  const yyyy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function loadProgress() {
  const p = progressPath();
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function saveProgress(progress) {
  const p = progressPath();
  fs.writeFileSync(p, JSON.stringify(progress, null, 2), "utf8");
}

function buildProgressSnapshot(progress) {
  const today = todayLocalISO();
  return {
    ...progress,
    completedToday: progress.lastCompletedDate === today,
    needsLessonToday: progress.lastCompletedDate !== today,
    today
  };
}

function upgradeProgressShape(progress) {
  if (!progress.everCompleted) {
    progress.everCompleted = {};
  }

  if (!progress.lessonCompletion) {
    progress.lessonCompletion = {};
  }

  for (const lessonId of Object.keys(progress.everCompleted)) {
    if (!progress.everCompleted[lessonId]) continue;
    if (!progress.lessonCompletion[lessonId]) {
      progress.lessonCompletion[lessonId] = {
        completed: true,
        completionCount: 1,
        firstCompletedAt: progress.lastCompletedDate,
        lastCompletedAt: progress.lastCompletedDate
      };
    }
  }

  return progress;
}

function ensureProgressSeeded(seedStreak = DEFAULT_SEED_STREAK) {
  const existing = loadProgress();
  if (existing) {
    const upgraded = upgradeProgressShape(existing);
    saveProgress(upgraded);
    return buildProgressSnapshot(upgraded);
  }

  const seeded = {
    currentStreak: seedStreak,
    longestStreak: seedStreak,
    lastCompletedDate: null,
    everCompleted: {},
    lessonCompletion: {}
  };

  saveProgress(seeded);
  return buildProgressSnapshot(seeded);
}

function applyCompletionForDate(progress, completedDate) {
  if (progress.lastCompletedDate === completedDate) {
    return progress;
  }

  const expectedNextDate = progress.lastCompletedDate
    ? addDaysISO(progress.lastCompletedDate, 1)
    : null;

  if (progress.lastCompletedDate === null) {
    progress.currentStreak = Math.max(progress.currentStreak || 0, 1);
  } else if (expectedNextDate === completedDate) {
    progress.currentStreak += 1;
  } else {
    progress.currentStreak = Math.max(progress.currentStreak || 0, 1);
  }

  progress.lastCompletedDate = completedDate;
  progress.longestStreak = Math.max(
    progress.longestStreak || 0,
    progress.currentStreak
  );

  return progress;
}

function applyOutsideCompletionForToday(progress, today) {
  if (progress.lastCompletedDate === today) {
    return progress;
  }

  const yesterday = addDaysISO(today, -1);

  if (progress.lastCompletedDate === yesterday) {
    progress.currentStreak = (progress.currentStreak || 0) + 1;
  } else {
    progress.currentStreak = Math.max(progress.currentStreak || 0, 1);
  }

  progress.lastCompletedDate = today;
  progress.longestStreak = Math.max(
    progress.longestStreak || 0,
    progress.currentStreak
  );

  return progress;
}

function markLessonCompleted(lessonId, seedStreak = DEFAULT_SEED_STREAK) {
  const progress = ensureProgressSeeded(seedStreak);
  const today = todayLocalISO();

  if (lessonId) {
    progress.everCompleted[lessonId] = true;
    const existingLessonProgress = progress.lessonCompletion[lessonId] ?? {
      completed: true,
      completionCount: 0,
      firstCompletedAt: null,
      lastCompletedAt: null
    };

    progress.lessonCompletion[lessonId] = {
      completed: true,
      completionCount: (existingLessonProgress.completionCount ?? 0) + 1,
      firstCompletedAt: existingLessonProgress.firstCompletedAt ?? today,
      lastCompletedAt: today
    };
  }

  if (progress.lastCompletedDate === today) {
    saveProgress(progress);
    return buildProgressSnapshot(progress);
  }

  applyCompletionForDate(progress, today);
  saveProgress(progress);
  return buildProgressSnapshot(progress);
}

function markOutsideAppYesterday(seedStreak = DEFAULT_SEED_STREAK) {
  const progress = ensureProgressSeeded(seedStreak);
  const today = todayLocalISO();
  const yesterday = addDaysISO(today, -1);

  if (progress.lastCompletedDate === today || progress.lastCompletedDate === yesterday) {
    saveProgress(progress);
    return buildProgressSnapshot(progress);
  }

  const eligibleGapDate = addDaysISO(today, -2);
  if (progress.lastCompletedDate !== null && progress.lastCompletedDate !== eligibleGapDate) {
    saveProgress(progress);
    return buildProgressSnapshot(progress);
  }

  applyCompletionForDate(progress, yesterday);
  saveProgress(progress);
  return buildProgressSnapshot(progress);
}

function markOutsideAppToday(seedStreak = DEFAULT_SEED_STREAK) {
  const progress = ensureProgressSeeded(seedStreak);
  const today = todayLocalISO();

  applyOutsideCompletionForToday(progress, today);
  saveProgress(progress);
  return buildProgressSnapshot(progress);
}

function setCurrentStreak(nextStreak, seedStreak = DEFAULT_SEED_STREAK) {
  const progress = ensureProgressSeeded(seedStreak);
  const parsed = Number(nextStreak);
  const safeStreak = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : progress.currentStreak || 0;

  progress.currentStreak = safeStreak;
  progress.longestStreak = Math.max(progress.longestStreak || 0, safeStreak);
  saveProgress(progress);
  return buildProgressSnapshot(progress);
}

module.exports = {
  ensureProgressSeeded,
  markLessonCompleted,
  markOutsideAppYesterday,
  markOutsideAppToday,
  setCurrentStreak
};
