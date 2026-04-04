const { app, BrowserWindow } = require('electron');
const path = require('path');

// 关闭站点隔离防御
app.commandLine.appendSwitch('disable-site-isolation-trials');

// ⚠️ 新增：强制提高日志过滤级别（0=INFO, 1=WARNING, 2=ERROR, 3=FATAL）
app.commandLine.appendSwitch('log-level', '3'); 

// 🚀 核心新增：彻底解除 Chromium 内核的媒体自动播放限制（允许带声音自动播放）
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');

function createWindow () {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    autoHideMenuBar: true, 
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webviewTag: true // 维持提权：保持 Electron 原生 webview 容器支持
    }
  });

  win.loadFile('index.html');
  
  // ⚠️ 发版清理：已将强制唤出开发者工具面板的代码注释隐藏
  // win.webContents.openDevTools();
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});