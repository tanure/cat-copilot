#!/usr/bin/env node

const { spawn, spawnSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');

const pluginRoot = path.resolve(__dirname, '..');
const args = process.argv.slice(2);

function renderStartupBrandLine() {
  const shouldShowBrandLine = process.env.CATPILOT_BRAND_LINE === '1';
  if (!shouldShowBrandLine || !process.stdout.isTTY) {
    return;
  }

  process.stderr.write('CatPilot · Copilot CLI assistant\n');
}

function findAgentFiles(agentsDirPath) {
  if (!fs.existsSync(agentsDirPath)) {
    return [];
  }

  const files = fs.readdirSync(agentsDirPath, { withFileTypes: true });
  return files
    .filter((entry) => entry.isFile() && entry.name.endsWith('.agent.md'))
    .map((entry) => entry.name);
}

function runCommandSync(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    shell: process.platform === 'win32',
    encoding: 'utf8',
    ...options
  });

  const stdout = result.stdout ? String(result.stdout).trim() : '';
  const stderr = result.stderr ? String(result.stderr).trim() : '';

  return {
    status: typeof result.status === 'number' ? result.status : 1,
    stdout,
    stderr,
    error: result.error
  };
}

function runCommand(command, commandArgs, options = {}) {
  const child = spawn(command, commandArgs, {
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options
  });

  child.on('error', (error) => {
    console.error(`❌ Failed to run \`${command}\`.`);
    console.error(`ℹ️ ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code, signal) => {
    if (signal) {
      process.exit(1);
    }
    process.exit(code ?? 0);
  });
}

function runSelfChecks() {
  const isDebug = process.env.CATPILOT_DEBUG === '1';
  const pluginConfigPath = path.join(pluginRoot, 'plugin.json');
  const agentsDirPath = path.join(pluginRoot, 'agents');
  const agentFiles = findAgentFiles(agentsDirPath);

  const missing = [];
  if (!fs.existsSync(pluginConfigPath)) {
    missing.push('plugin.json');
  }
  if (!fs.existsSync(agentsDirPath)) {
    missing.push('agents/');
  }
  if (agentFiles.length === 0) {
    missing.push('agents/*.agent.md');
  }

  if (missing.length > 0) {
    console.warn(`⚠️ CatPilot plugin assets look incomplete at: ${pluginRoot}`);
    console.warn(`ℹ️ Missing: ${missing.join(', ')}`);
    console.warn('ℹ️ Run `catpilot update` or `npm update -g @alberttanure/catpilot-cli`, then restart your shell.');
    return;
  }

  if (isDebug) {
    console.error(`ℹ️ CatPilot plugin root: ${pluginRoot}`);
    console.error(`ℹ️ Discovered agents: ${agentFiles.join(', ')}`);
  }
}

function collectDiagnostics() {
  const pluginConfigPath = path.join(pluginRoot, 'plugin.json');
  const agentsDirPath = path.join(pluginRoot, 'agents');
  const agentFiles = findAgentFiles(agentsDirPath);

  const checks = {
    pluginRoot,
    pluginConfigPath,
    agentsDirPath,
    agentFiles,
    pluginConfigExists: fs.existsSync(pluginConfigPath),
    agentsDirExists: fs.existsSync(agentsDirPath),
    copilotVersion: null,
    copilotAvailable: false
  };

  const copilotVersionResult = runCommandSync('copilot', ['--version']);
  checks.copilotAvailable = copilotVersionResult.status === 0;
  checks.copilotVersion = checks.copilotAvailable
    ? copilotVersionResult.stdout || copilotVersionResult.stderr
    : null;

  const issues = [];
  if (!checks.pluginConfigExists) {
    issues.push('Missing plugin.json');
  }
  if (!checks.agentsDirExists) {
    issues.push('Missing agents/ directory');
  }
  if (checks.agentFiles.length === 0) {
    issues.push('No agents/*.agent.md files found');
  }
  if (!checks.copilotAvailable) {
    issues.push('copilot CLI not available in PATH');
  }

  return { checks, issues };
}

function runDoctor() {
  const { checks, issues } = collectDiagnostics();
  const packageJsonPath = path.join(pluginRoot, 'package.json');
  let packageVersion = 'unknown';

  try {
    if (fs.existsSync(packageJsonPath)) {
      const raw = fs.readFileSync(packageJsonPath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed.version === 'string') {
        packageVersion = parsed.version;
      }
    }
  } catch {
    packageVersion = 'unknown';
  }

  console.error('🩺 CatPilot doctor report');
  console.error(`ℹ️ CatPilot version: ${packageVersion}`);
  console.error(`ℹ️ Node version: ${process.version}`);
  console.error(`ℹ️ Plugin root: ${checks.pluginRoot}`);
  console.error(`ℹ️ plugin.json: ${checks.pluginConfigExists ? 'found' : 'missing'} (${checks.pluginConfigPath})`);
  console.error(`ℹ️ agents dir: ${checks.agentsDirExists ? 'found' : 'missing'} (${checks.agentsDirPath})`);
  console.error(`ℹ️ agent files: ${checks.agentFiles.length > 0 ? checks.agentFiles.join(', ') : 'none'}`);
  console.error(`ℹ️ copilot CLI: ${checks.copilotAvailable ? 'found' : 'missing'}`);
  if (checks.copilotVersion) {
    console.error(`ℹ️ copilot version: ${checks.copilotVersion}`);
  }

  if (issues.length === 0) {
    console.error('✅ Doctor checks passed. CatPilot should be discoverable by `/agents`.');
    process.exit(0);
  }

  console.error('⚠️ Issues found:');
  for (const issue of issues) {
    console.error(` - ${issue}`);
  }
  console.error('ℹ️ Suggested fixes: run `catpilot update`, restart your shell, and verify `copilot --version`.');
  process.exit(1);
}

const firstArg = args[0]?.toLowerCase();
if (firstArg === 'update') {
  console.error('ℹ️ Updating CatPilot globally from npm...');
  runCommand('npm', ['update', '-g', '@alberttanure/catpilot-cli']);
}

if (firstArg === 'doctor') {
  runDoctor();
}

renderStartupBrandLine();
runSelfChecks();
runCommand('copilot', args, { cwd: pluginRoot });
