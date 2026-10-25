const { app, BrowserWindow, Menu, dialog, ipcMain } = require('electron');
const fs = require('node:fs/promises');
const path = require('node:path');
let currentCircuitPath = null;

// This Linux environment blocks both Chromium sandbox backends.
if (process.platform === 'linux') app.commandLine.appendSwitch('no-sandbox');

const gateTypes = new Set(['AND', 'OR', 'NOT', 'XOR']);

function validateCircuit(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.parts) || !Array.isArray(data.links)) {
    throw new Error('회로 파일 형식 또는 버전이 올바르지 않습니다.');
  }
  if (!Number.isInteger(data.nextId) || data.nextId < 0 || !Number.isInteger(data.tile)
      || data.tile < 12 || data.tile > 64) {
    throw new Error('회로 파일의 타일 또는 ID 값이 올바르지 않습니다.');
  }

  const byId = new Map();
  for (const part of data.parts) {
    if (!Number.isInteger(part.id) || part.id < 0 || byId.has(part.id)
        || !Number.isFinite(part.x) || !Number.isFinite(part.y)) {
      throw new Error('회로 파일에 중복되거나 잘못된 오브젝트 ID/좌표가 있습니다.');
    }
    if (!['input', 'lamp', 'memo', ...gateTypes].includes(part.type)) {
      throw new Error(`지원하지 않는 오브젝트 종류: ${part.type}`);
    }
    if (part.type === 'input' && ![0, 1].includes(part.value)) {
      throw new Error(`입력값이 올바르지 않습니다: ${part.id}`);
    }
    byId.set(part.id, part);
  }
  if (data.parts.some(part => part.id >= data.nextId)) throw new Error('다음 ID가 기존 오브젝트와 충돌합니다.');

  const occupiedInputs = new Set();
  for (const link of data.links) {
    const source = byId.get(link.from), target = byId.get(link.to);
    const inputCount = target?.type === 'NOT' || target?.type === 'lamp' ? 1 : 2;
    if (!source || !target || !Number.isInteger(link.index) || link.index < 0 || link.index >= inputCount
        || ['lamp', 'memo'].includes(source.type) || target.type === 'input' || target.type === 'memo') {
      throw new Error('회로 파일에 잘못된 선 연결이 있습니다.');
    }
    const key = `${link.to}:${link.index}`;
    if (occupiedInputs.has(key)) throw new Error('입력 포트에 중복 연결이 있습니다.');
    occupiedInputs.add(key);
  }
  return data;
}

ipcMain.handle('logic:save-circuit', async (event, data) => {
  try {
    validateCircuit(data);
    let filePath = currentCircuitPath;
    if (!filePath) {
      const result = await dialog.showSaveDialog(BrowserWindow.fromWebContents(event.sender), {
        title: '회로 저장',
        defaultPath: 'logic-circuit.json',
        filters: [{ name: 'Logic circuit', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      filePath = result.filePath;
    }
    await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    currentCircuitPath = filePath;
    return { canceled: false, filePath };
  } catch (error) {
    return { error: error.message };
  }
});

ipcMain.handle('logic:load-circuit', async event => {
  try {
    const result = await dialog.showOpenDialog(BrowserWindow.fromWebContents(event.sender), {
      title: '회로 열기',
      properties: ['openFile'],
      filters: [{ name: 'Logic circuit', extensions: ['json'] }]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true };
    const filePath = result.filePaths[0];
    const data = validateCircuit(JSON.parse(await fs.readFile(filePath, 'utf8')));
    currentCircuitPath = filePath;
    return { canceled: false, filePath, circuit: data };
  } catch (error) {
    return { error: error.message };
  }
});

function createWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    title: 'logic',
    backgroundColor: '#09090b',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  window.loadFile(path.join(__dirname, 'index.html'));
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
