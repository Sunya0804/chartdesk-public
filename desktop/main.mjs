// 데스크톱 앱. server.mjs를 이 프로세스 안에서 띄우고 그 주소를 창에 연다.
// 새 버전은 GitHub Releases(Sunya0804/chartdesk-public)에서 받는다.
import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from "electron";
import electronUpdater from "electron-updater";
import { appendFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const { autoUpdater } = electronUpdater;
const here = fileURLToPath(new URL(".", import.meta.url));
// 화면 설정(localStorage)은 주소의 포트마다 따로 저장되므로 포트를 고정한다.
// 브라우저용 `node server.mjs`(5173)와 겹치지 않는 번호를 쓴다.
const PORT = 51730;
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000;

let window = null;
let origin = "";
let updateStatus = "";

const log = (text) => appendFile(join(app.getPath("userData"), "update.log"), `${new Date().toISOString()} ${text}\n`).catch(() => {});

function setStatus(text) {
  updateStatus = text;
  log(text);
  window?.webContents.send("update-status", text);
}

function openWindow() {
  window = new BrowserWindow({
    width: 1600,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    title: "ChartDesk",
    backgroundColor: "#0b0e14",
    icon: join(here, "icon.png"),
    webPreferences: {
      preload: join(here, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      additionalArguments: [`--chartdesk-version=${app.getVersion()}`],
    },
  });
  // AI의 "웹에서" 버튼이나 바깥 링크는 기본 브라우저로 연다.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith(origin)) shell.openExternal(url);
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith(origin)) return;
    event.preventDefault();
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
  });
  window.on("closed", () => {
    window = null;
  });
  window.loadURL(origin);
}

async function checkForUpdates() {
  if (!app.isPackaged) return "개발 실행이라 업데이트를 확인하지 않습니다";
  try {
    await autoUpdater.checkForUpdates();
  } catch {
    // 상태는 autoUpdater의 error 이벤트가 이미 적었다.
  }
  return updateStatus;
}

/** 릴리스 노트(HTML 또는 버전별 목록)를 확인 창에 넣을 글로 바꾼다. 너무 길면 자른다. */
function releaseNotesText(notes) {
  const plain = (html) => String(html ?? "")
    .replace(/<li>/gi, "• ")
    .replace(/<\/(p|li|h\d)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/\n{2,}/g, "\n")
    .trim();
  const parts = Array.isArray(notes)
    ? notes.map((item) => `[${item.version}]\n${plain(item.note)}`)
    : notes ? [plain(notes)] : [];
  if (parts.length === 0) return "";
  let text = parts.join("\n\n");
  if (text.length > 1800) text = `${text.slice(0, 1800)}…\n(전체 내용은 다시 시작한 뒤 앱에서 볼 수 있습니다)`;
  return `업데이트 내용\n${text}\n\n`;
}

function watchUpdates() {
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // latest.yml이 가리키는 최신 버전을 곧바로 받는다. 지금 버전 이후의 릴리스 노트를 모두 받아 확인 창에 보여 준다.
  autoUpdater.fullChangelog = true;
  autoUpdater.on("checking-for-update", () => setStatus("업데이트 확인 중…"));
  autoUpdater.on("update-not-available", () => setStatus("최신 버전입니다"));
  autoUpdater.on("update-available", (info) => setStatus(`새 버전 ${info.version} 받는 중…`));
  autoUpdater.on("download-progress", (progress) => {
    updateStatus = `새 버전 받는 중… ${Math.round(progress.percent)}%`;
    window?.webContents.send("update-status", updateStatus);
  });
  autoUpdater.on("error", (error) => setStatus(`업데이트 오류: ${error?.message ?? error}`));
  autoUpdater.on("update-downloaded", async (info) => {
    setStatus(`새 버전 ${info.version} 준비됨. 앱을 다시 켜면 적용됩니다`);
    if (!window) return;
    const { response } = await dialog.showMessageBox(window, {
      type: "info",
      buttons: ["지금 다시 시작", "나중에"],
      defaultId: 0,
      cancelId: 1,
      title: "ChartDesk 업데이트",
      message: `새 버전 ${info.version}을 받았습니다.`,
      detail: `${releaseNotesText(info.releaseNotes)}지금 다시 시작하면 바로 적용됩니다. 나중을 고르면 앱을 끌 때 적용됩니다.`,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });
  checkForUpdates();
  setInterval(checkForUpdates, CHECK_EVERY_MS).unref();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.setAppUserModelId("com.sunya0804.chartdesk");
  Menu.setApplicationMenu(null);
  app.on("second-instance", () => {
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  ipcMain.handle("update-status", () => updateStatus);
  ipcMain.handle("check-updates", () => checkForUpdates());
  app.on("window-all-closed", () => app.quit());

  app.whenReady().then(async () => {
    // 서버 모듈은 키 파일 위치를 정한 뒤에 띄운다. 앱 폴더는 읽기 전용이라 사용자 데이터 폴더에 둔다.
    const { startServer } = await import("../server.mjs");
    try {
      ({ url: origin } = await startServer({ port: PORT, keyFile: join(app.getPath("userData"), "ai-keys.json") }));
    } catch (error) {
      dialog.showErrorBox("ChartDesk를 시작하지 못했습니다", `포트 ${PORT}을 쓸 수 없습니다. 다른 프로그램이 쓰고 있는지 확인하세요.\n\n${error?.message ?? error}`);
      app.quit();
      return;
    }
    openWindow();
    if (app.isPackaged) watchUpdates();
    else updateStatus = "개발 실행이라 업데이트를 확인하지 않습니다";
  });
}
