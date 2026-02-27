// src/api.js

export const api = {
  getThemes: () => window.api.getThemes(),

  getLessonsByTheme: (themeCode) =>
    window.api.getLessonsByTheme(themeCode),

  getLessonRun: (lessonCode) =>
    window.api.getLessonRun(lessonCode)
};