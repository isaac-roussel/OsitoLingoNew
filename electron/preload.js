// electron/preload.js
const { contextBridge, ipcRenderer } = require("electron");

console.log("✅ preload loaded");

contextBridge.exposeInMainWorld("__preload_ok", true);

contextBridge.exposeInMainWorld("api", {
  getThemes: () => ipcRenderer.invoke("content:getThemes"),
  getLessonsByTheme: (themeCode) =>
    ipcRenderer.invoke("content:getLessonsByTheme", themeCode),
  getLessonRun: (lessonCode) =>
    ipcRenderer.invoke("content:getLessonRun", lessonCode),
});

contextBridge.exposeInMainWorld("progressApi", {
  get: () => ipcRenderer.invoke("progress:get"),
  completeLesson: (lessonCode) => ipcRenderer.invoke("progress:complete", lessonCode),
});