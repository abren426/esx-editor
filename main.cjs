const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');

function createWindow() {
  const window = new BrowserWindow({
    width: 1440, height: 940, minWidth: 1100, minHeight: 720,
    backgroundColor: '#11130f', title: 'ESX Soundbank Studio',
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false }
  });
  window.loadFile('index.html');
}

app.whenReady().then(() => {
  ipcMain.handle('file:open-esx', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'ESX soundbank', extensions: ['esx'] }, { name: 'All files', extensions: ['*'] }] });
    if (canceled || !filePaths[0]) return null;
    const filePath = filePaths[0];
    return { name: path.basename(filePath), path: filePath, data: await fs.readFile(filePath) };
  });
  ipcMain.handle('file:open-audio', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'Audio', extensions: ['wav', 'wave', 'aif', 'aiff', 'mp3', 'flac', 'ogg'] }] });
    if (canceled || !filePaths[0]) return null;
    const filePath = filePaths[0];
    return { name: path.basename(filePath), data: await fs.readFile(filePath) };
  });
  ipcMain.handle('file:save-esx', async (_event, payload) => {
    const { canceled, filePath } = await dialog.showSaveDialog({ defaultPath: payload.name || 'New Soundbank.esx', filters: [{ name: 'ESX soundbank', extensions: ['esx'] }] });
    if (canceled || !filePath) return null;
    await fs.writeFile(filePath, Buffer.from(payload.data));
    return { path: filePath, name: path.basename(filePath) };
  });
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
