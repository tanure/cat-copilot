#!/usr/bin/env node

import readline from 'readline';
import fs from 'fs';
import path from 'path';
import * as cliUtils from './cli-utils.js';

/**
 * Interactive setup for CatPilot config
 */

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

/**
 * Prompt user for input
 * @param {string} question - Question to ask
 * @returns {Promise<string>} User response
 */
function prompt(question) {
  return new Promise(resolve => {
    rl.question(question, resolve);
  });
}

/**
 * Run interactive setup flow
 * @param {string} projectRoot - Project root directory
 * @returns {Promise<object>} Config object
 */
async function runSetup(projectRoot = process.cwd()) {
  console.log('\n🛠️  CatPilot Setup\n');

  // 1. Storage root path
  console.log('📂 Step 1: Storage Root Path');
  console.log('(default: "data", or provide absolute path)');
  let storageRoot = await prompt('Enter storage path: ');
  storageRoot = storageRoot.trim() || 'data';

  // Resolve absolute path
  const resolvedRoot = path.isAbsolute(storageRoot)
    ? storageRoot
    : path.join(projectRoot, storageRoot);

  console.log(`   📍 Resolved to: ${resolvedRoot}`);

  // 2. Partitioning mode
  console.log('\n📅 Step 2: Partitioning Mode');
  console.log('   - day:   YYYY/YYYY-MM/YYYY-MM-DD');
  console.log('   - week:  YYYY/Www');
  console.log('   - month: YYYY/YYYY-MM (default)');
  let partitioning = await prompt('Choose partitioning [day|week|month]: ');
  partitioning = (partitioning.trim() || 'month').toLowerCase();

  if (!['day', 'week', 'month'].includes(partitioning)) {
    console.log('   ⚠️  Invalid choice, using month');
    partitioning = 'month';
  }

  // 3. Migration mode (if legacy files exist)
  console.log('\n🔄 Step 3: Migration Mode');
  const legacyFiles = ['tasks.md', 'journal.md', 'milestones.md', 'memos'];
  const legacyDataRoot = path.join(projectRoot, 'data');
  let needsMigration = false;

  for (const file of legacyFiles) {
    const legacyPath = path.join(legacyDataRoot, file);
    if (fs.existsSync(legacyPath)) {
      needsMigration = true;
      break;
    }
  }

  let migration = 'move';
  if (needsMigration) {
    console.log('   ⚠️  Legacy files detected in data/');
    console.log('   - move:  Move to new location, keep backup');
    console.log('   - copy:  Copy to new location, keep legacy');
    console.log('   - adopt: Keep legacy as-is (default)');
    migration = await prompt('Choose migration [move|copy|adopt]: ');
    migration = (migration.trim() || 'adopt').toLowerCase();

    if (!['move', 'copy', 'adopt'].includes(migration)) {
      console.log('   ⚠️  Invalid choice, using adopt');
      migration = 'adopt';
    }
  }

  // 4. Summary
  console.log('\n📋 Configuration Summary:');
  console.log(`   Storage root:   ${resolvedRoot}`);
  console.log(`   Partitioning:   ${partitioning}`);
  console.log(`   Migration mode: ${migration}`);

  const confirmed = await prompt('\n✅ Proceed? [y/n]: ');
  if (confirmed.toLowerCase() !== 'y') {
    console.log('❌ Setup cancelled.');
    rl.close();
    return null;
  }

  // 5. Create config
  const config = {
    version: 1,
    storage: {
      root: storageRoot,
      partitioning,
      allowExternalPaths: true,
      files: {
        tasks: 'tasks.md',
        journal: 'journal.md',
        milestones: 'milestones.md',
        memos: 'memos'
      }
    },
    migration: {
      mode: migration
    }
  };

  // 6. Write config
  const configDir = path.join(projectRoot, 'data');
  cliUtils.ensureDir(configDir);
  const configPath = path.join(configDir, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');

  console.log(`\n✅ Config created at ${configPath}`);

  // 7. Handle migration
  if (needsMigration) {
    console.log('\n🔄 Processing migration...');
    handleMigration(projectRoot, config, legacyFiles, migration);
  }

  rl.close();
  return config;
}

/**
 * Handle file migration
 * @param {string} projectRoot - Project root
 * @param {object} config - Config object
 * @param {array} legacyFiles - Legacy file names
 * @param {string} mode - Migration mode
 */
function handleMigration(projectRoot, config, legacyFiles, mode) {
  const legacyRoot = path.join(projectRoot, 'data');
  const newRoot = path.isAbsolute(config.storage.root)
    ? config.storage.root
    : path.join(projectRoot, config.storage.root);
  const partition = cliUtils.getPartitionFolder(config.storage.partitioning);
  const newDir = path.join(newRoot, partition);

  cliUtils.ensureDir(newDir);

  for (const file of legacyFiles) {
    const legacyPath = path.join(legacyRoot, file);
    if (!fs.existsSync(legacyPath)) continue;

    const newPath = path.join(newDir, file);

    if (mode === 'move') {
      fs.copyFileSync(legacyPath, newPath);
      fs.writeFileSync(`${legacyPath}.bak`, fs.readFileSync(legacyPath), 'utf8');
      console.log(`   ✅ Moved ${file} → ${path.relative(projectRoot, newPath)}`);
    } else if (mode === 'copy') {
      fs.copyFileSync(legacyPath, newPath);
      console.log(`   ✅ Copied ${file} → ${path.relative(projectRoot, newPath)}`);
    } else if (mode === 'adopt') {
      console.log(`   ℹ️  Adopted legacy ${file}`);
    }
  }
}

export {
  runSetup
};
