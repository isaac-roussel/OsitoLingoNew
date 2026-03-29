// electron/progressStore.js
const fs = require("fs");
const path = require("path");
const { app } = require("electron");

function progressPath() {
  return path.join(app.getPath("userData"), "progress.json");
}

// YYYY-MM-DD in America/Detroit
function todayDetroitISO() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
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

function upgradeProgressShape(progress) {
  if (!progress.everCompleted) {
    progress.everCompleted = {};
  }

  return progress;
}

function ensureProgressSeeded(seedStreak = 0) {
  const existing = loadProgress();
  if (existing) {
    const upgraded = upgradeProgressShape(existing);
    saveProgress(upgraded);
    return upgraded;
  }

  const seeded = {
    currentStreak: seedStreak,
    longestStreak: seedStreak,
    lastCompletedDate: null,
    everCompleted: {}
  };

  saveProgress(seeded);
  return seeded;
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
    progress.currentStreak = 1;
  }

  progress.lastCompletedDate = completedDate;
  progress.longestStreak = Math.max(
    progress.longestStreak || 0,
    progress.currentStreak
  );

  return progress;
}

function markLessonCompleted(lessonId, seedStreak = 1683) {
  const progress = ensureProgressSeeded(seedStreak);
  const today = todayDetroitISO();

  if (lessonId) {
    progress.everCompleted[lessonId] = true;
  }

  if (progress.lastCompletedDate === today) {
    saveProgress(progress);
    return progress;
  }

  applyCompletionForDate(progress, today);
  saveProgress(progress);
  return progress;
}

function markOutsideAppYesterday(seedStreak = 1683) {
  const progress = ensureProgressSeeded(seedStreak);
  const today = todayDetroitISO();
  const yesterday = addDaysISO(today, -1);

  if (progress.lastCompletedDate === today || progress.lastCompletedDate === yesterday) {
    saveProgress(progress);
    return progress;
  }

  const eligibleGapDate = addDaysISO(today, -2);
  if (progress.lastCompletedDate !== null && progress.lastCompletedDate !== eligibleGapDate) {
    saveProgress(progress);
    return progress;
  }

  applyCompletionForDate(progress, yesterday);
  saveProgress(progress);
  return progress;
}

function setCurrentStreak(nextStreak, seedStreak = 1683) {
  const progress = ensureProgressSeeded(seedStreak);
  const parsed = Number(nextStreak);
  const safeStreak = Number.isFinite(parsed) ? Math.max(0, Math.floor(parsed)) : progress.currentStreak || 0;

  progress.currentStreak = safeStreak;
  progress.longestStreak = Math.max(progress.longestStreak || 0, safeStreak);
  saveProgress(progress);
  return progress;
}

module.exports = {
  ensureProgressSeeded,
  markLessonCompleted,
  markOutsideAppYesterday,
  setCurrentStreak
};
