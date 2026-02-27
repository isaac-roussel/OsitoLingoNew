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

function ensureProgressSeeded(seedStreak = 0 ) {
  const existing = loadProgress();
  if (existing) {
    // Backward compatibility: ensure everCompleted exists
    if (!existing.everCompleted) {
      existing.everCompleted = {};
      saveProgress(existing);
    }
    return existing;
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

// 🔹 NEW: lessonId parameter
function markLessonCompleted(lessonId, seedStreak = 1683) {
  const progress = ensureProgressSeeded(seedStreak);
  const today = todayDetroitISO();

  // ---- Mark lesson as ever completed ----
  if (lessonId) {
    progress.everCompleted[lessonId] = true;
  }

  // ---- Streak logic (unchanged behavior) ----

  // already counted today
  if (progress.lastCompletedDate === today) {
    saveProgress(progress);
    return progress;
  }

  const yesterday = addDaysISO(today, -1);

  if (progress.lastCompletedDate === null) {
    progress.lastCompletedDate = today;
  } else if (progress.lastCompletedDate === yesterday) {
    progress.currentStreak += 1;
    progress.lastCompletedDate = today;
  } else {
    progress.currentStreak = 1;
    progress.lastCompletedDate = today;
  }

  progress.longestStreak = Math.max(
    progress.longestStreak || 0,
    progress.currentStreak
  );

  saveProgress(progress);
  return progress;
}

module.exports = {
  ensureProgressSeeded,
  markLessonCompleted
};