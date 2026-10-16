// Disposable Chromium host: no application code, IPC, workspace or database.
const { app, BrowserWindow, Menu } = require('electron');
app.setPath('userData', process.env.UI_TEST_USER_DATA);
app.commandLine.appendSwitch('disable-background-timer-throttling');
app.whenReady().then(async () => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }]));
  const window = new BrowserWindow({
    width: 1100,
    height: 900,
    show: false,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  await window.loadFile(process.env.UI_TEST_INDEX);
});
app.on('window-all-closed', () => app.quit());
