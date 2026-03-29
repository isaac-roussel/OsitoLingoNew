// src/api.js

export const api = {
  getLanguages: () => window.api.getLanguages(),

  getThemes: () => window.api.getThemes(),

  getLessonsByTheme: (themeCode) =>
    window.api.getLessonsByTheme(themeCode),

  getLessonRun: (lessonCode) =>
    window.api.getLessonRun(lessonCode)
};
