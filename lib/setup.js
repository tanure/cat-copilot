#!/usr/bin/env node

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import os from 'os';
import * as cliUtils from './cli-utils.js';

/**
 * Interactive (and non-interactive) setup for CatPilot config.
 *
 * By default this writes a GLOBAL config at ~/.catpilot/config.json so that
 * CatPilot resolves to the same storage from every directory. Pass { local: true }
 * to write a project-local config at <cwd>/data/config.json instead.
 */

const ALL_FILES = {
  tasks: 'tasks.md',
  journal: 'journal.md',
  milestones: 'milestones.md',
  memos: 'memos',
  learning: 'learning',
  growth: 'growth',
  projects: 'projects',
  pomodoro: 'pomodoro.md'
};

// Default Pomodoro session durations (minutes). Persisted as a top-level
// `pomodoro` block so the timer honors them without a per-call --minutes.
const DEFAULT_POMODORO = {
  focus: 25,
  'short-break': 5,
  'long-break': 15
};

function prompt(rl, question) {
  return new Promise(resolve => rl.question(question, resolve));
}

/**
 * Suggest a sensible default storage root for a global config.
 * Prefers an existing Obsidian-style vault if one is obvious, else ~/.catpilot/vault.
 */
function defaultGlobalRoot() {
  const home = os.homedir();
  const candidates = [
    path.join(home, 'Obsidian'),
    path.join(home, 'Documents', 'Obsidian'),
    path.join(home, 'vault'),
    path.join(home, 'Knowledge')
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return path.join(home, '.catpilot', 'vault');
}

function buildConfig(resolvedRoot, partitioning, migration, pomodoro = DEFAULT_POMODORO) {
  return {
    version: 1,
    storage: {
      root: resolvedRoot,
      partitioning,
      allowExternalPaths: true,
      files: { ...ALL_FILES }
    },
    migration: { mode: migration },
    pomodoro: { ...DEFAULT_POMODORO, ...pomodoro }
  };
}

function writeConfig(configPath, config) {
  cliUtils.ensureDir(path.dirname(configPath));
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
}

/**
 * Run setup.
 * @param {object} opts
 * @param {boolean} [opts.local]        Write a project-local config instead of global
 * @param {string}  [opts.root]         Storage root (absolute recommended)
 * @param {string}  [opts.partitioning] day|week|month
 * @param {boolean} [opts.yes]          Skip prompts / confirmation
 * @param {string}  [opts.projectRoot]  Base dir for a local config (default cwd)
 * @returns {Promise<object|null>}
 */
async function runSetup(opts = {}) {
  const local = !!opts.local;
  const projectRoot = opts.projectRoot || process.cwd();
  const configPath = local
    ? path.join(projectRoot, 'data', 'config.json')
    : cliUtils.GLOBAL_CONFIG_PATH;

  const interactive = !opts.yes && process.stdin.isTTY && process.stdout.isTTY;

  console.log('\n🛠️  CatPilot Setup');
  console.log(local
    ? `   Scope: project-local (${configPath})`
    : `   Scope: global — shared across every directory (${configPath})`);

  let storageRoot = opts.root && String(opts.root).trim();
  let partitioning = opts.partitioning && String(opts.partitioning).trim().toLowerCase();

  let rl;
  if (interactive) {
    rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  }

  try {
    if (!storageRoot) {
      const suggested = local ? 'data' : defaultGlobalRoot();
      if (interactive) {
        console.log('\n📂 Storage Root Path');
        console.log(`(absolute path recommended; default: ${suggested})`);
        const answer = (await prompt(rl, 'Enter storage path: ')).trim();
        storageRoot = answer || suggested;
      } else {
        storageRoot = suggested;
      }
    }

    // For a GLOBAL config, always store an ABSOLUTE root so it works from anywhere.
    const base = local ? projectRoot : path.dirname(configPath);
    const resolvedRoot = path.isAbsolute(storageRoot)
      ? storageRoot
      : path.resolve(base, storageRoot);

    if (!partitioning) {
      if (interactive) {
        console.log('\n📅 Partitioning Mode [day|week|month] (default: month)');
        const answer = (await prompt(rl, 'Choose partitioning: ')).trim().toLowerCase();
        partitioning = answer || 'month';
      } else {
        partitioning = 'month';
      }
    }
    if (!['day', 'week', 'month'].includes(partitioning)) {
      console.log(`   ⚠️  Invalid partitioning "${partitioning}", using month`);
      partitioning = 'month';
    }

    // Pomodoro session durations (optional; Enter accepts the default).
    const pomodoro = { ...DEFAULT_POMODORO };
    if (interactive) {
      console.log('\n🍅 Pomodoro durations (minutes) — press Enter to accept defaults');
      for (const [key, label] of [['focus', 'Focus'], ['short-break', 'Short break'], ['long-break', 'Long break']]) {
        const answer = (await prompt(rl, `   ${label} (default ${DEFAULT_POMODORO[key]}): `)).trim();
        const n = parseInt(answer, 10);
        if (Number.isFinite(n) && n > 0) pomodoro[key] = n;
      }
    }

    const migration = 'adopt';
    const config = buildConfig(resolvedRoot, partitioning, migration, pomodoro);

    console.log('\n📋 Configuration Summary:');
    console.log(`   Config file:   ${configPath}`);
    console.log(`   Storage root:  ${resolvedRoot}`);
    console.log(`   Partitioning:  ${partitioning}`);
    console.log(`   Pomodoro:      focus ${pomodoro.focus} · short ${pomodoro['short-break']} · long ${pomodoro['long-break']} min`);

    if (interactive) {
      const confirmed = (await prompt(rl, '\n✅ Proceed? [Y/n]: ')).trim().toLowerCase();
      if (confirmed === 'n' || confirmed === 'no') {
        console.log('❌ Setup cancelled.');
        return null;
      }
    }

    writeConfig(configPath, config);
    cliUtils.ensureDir(resolvedRoot);

    console.log(`\n✅ Config created at ${configPath}`);
    console.log(`📦 Storage ready at ${resolvedRoot}`);
    if (!local) {
      console.log('\nℹ️  This is your shared CatPilot brain. Every surface (CLI, VS Code,');
      console.log('   Copilot App, MCP) will read/write here from any directory.');
    }
    return config;
  } finally {
    if (rl) rl.close();
  }
}

export {
  runSetup
};
