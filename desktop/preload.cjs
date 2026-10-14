// 화면에서 쓸 수 있는 데스크톱 기능: 버전, 업데이트 상태, 업데이트 확인.
const { contextBridge, ipcRenderer } = require("electron");

const version = (process.argv.find((arg) => arg.startsWith("--chartdesk-version=")) ?? "").split("=")[1] ?? "";
let status = "";
ipcRenderer.on("update-status", (_event, text) => {
  status = text;
});
ipcRenderer.invoke("update-status").then((text) => {
  status = status || text;
});

contextBridge.exposeInMainWorld("chartdeskApp", {
  version,
  updateStatus: () => status,
  checkForUpdates: () => ipcRenderer.invoke("check-updates"),
});
