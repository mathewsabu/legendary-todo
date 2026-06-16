const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');

// Set unique App User Model ID for Windows taskbar icon grouping
app.setAppUserModelId('com.focusflow.todo');

// Listen for theme changes to dynamically skin standard OS title bar controls
ipcMain.on('theme-changed', (event, theme) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win && typeof win.setTitleBarOverlay === 'function') {
    if (theme === 'light') {
      win.setTitleBarOverlay({
        color: '#eaeaea',       // Light grey sidebar color
        symbolColor: '#18181b',  // Carbon black symbols
        height: 35
      });
    } else {
      win.setTitleBarOverlay({
        color: '#181818',       // Dark grey sidebar color
        symbolColor: '#9ca3af',  // Silver symbols
        height: 35
      });
    }
  }
});

function createWindow() {
  // Remove traditional native menu bar (File, Edit, View, Help)
  Menu.setApplicationMenu(null);

  const win = new BrowserWindow({
    width: 1280,
    height: 850,
    minWidth: 900,
    minHeight: 650,
    titleBarStyle: 'hidden', // Frameless client window, standard controls preserved
    titleBarOverlay: {
      color: '#181818',      // Match sidebar base background
      symbolColor: '#9ca3af', // Grey controls
      height: 35
    },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    title: "Focus Flow Todo",
  });

  // For developer ease, you can open DevTools with Ctrl+Shift+I inside Electron.
  // win.webContents.openDevTools();

  win.loadFile(path.join(__dirname, 'src', 'index.html'));
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
