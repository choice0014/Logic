const { spawn } = require('node:child_process');

const electron = require('electron');
const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.'];
const app = spawn(electron, args, { stdio: 'inherit' });

app.on('error', error => {
  console.error(`logic 실행 실패: ${error.message}`);
  process.exitCode = 1;
});

app.on('exit', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
