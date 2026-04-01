const { app, BrowserWindow } = require('electron');
const path = require('path');

function createWindow () {
  const win = new BrowserWindow({
    width: 1280,
    height: 720,
    // 隐藏默认的顶部菜单栏，让软件看起来更沉浸
    autoHideMenuBar: true, 
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      // ⚠️ 终极魔法：在物理物理层面彻底关闭浏览器的同源安全策略！
      webSecurity: false 
    }
  });

  // 加载我们写好的本地 HTML 界面
  win.loadFile('index.html');
}

// 当 Electron 准备就绪时，打开窗口
app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

// 当所有窗口关闭时退出软件
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});