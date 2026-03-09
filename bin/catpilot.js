#!/usr/bin/env node

const { spawn } = require('node:child_process');
const path = require('node:path');

const pluginRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

const child = spawn('copilot', args, {
  cwd: pluginRoot,
  stdio: 'inherit',
  shell: process.platform === 'win32'
});

child.on('error', (error) => {
  console.error('❌ Failed to run `copilot`. Make sure GitHub Copilot CLI is installed and available in PATH.');
  console.error(`ℹ️ ${error.message}`);
  process.exit(1);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.exit(1);
  }
  process.exit(code ?? 0);
});
