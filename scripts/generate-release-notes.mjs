#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const versionArg = process.argv[2];
if (!versionArg) {
  console.error('Usage: node scripts/generate-release-notes.mjs <version>');
  process.exit(1);
}

const rootDir = process.cwd();
const changelogPath = path.join(rootDir, 'CHANGELOG.md');
const templatePath = path.join(rootDir, '.github', 'release-template.md');

if (!fs.existsSync(changelogPath)) {
  console.error('CHANGELOG.md not found.');
  process.exit(1);
}

const content = fs.readFileSync(changelogPath, 'utf8');
const sectionRegex = new RegExp(
  String.raw`^## \[${versionArg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\] - .*?[\r\n]+([\s\S]*?)(?=^## \[|\Z)`,
  'm'
);
const match = content.match(sectionRegex);

let body = '';
if (match && match[1]) {
  body = match[1].trim();
}

if (!body) {
  if (fs.existsSync(templatePath)) {
    const template = fs.readFileSync(templatePath, 'utf8');
    body = template
      .replaceAll('{{VERSION}}', versionArg)
      .replaceAll('{{DATE}}', new Date().toISOString().slice(0, 10));
  } else {
    body = `### Highlights\n- Release v${versionArg}\n`;
  }
}

const output = [
  `# CatPilot v${versionArg}`,
  '',
  body,
  '',
  '## Links',
  `- npm package: https://www.npmjs.com/package/@alberttanure/catpilot-cli`,
  `- Changelog: https://github.com/tanure/cat-copilot/blob/main/CHANGELOG.md`
].join('\n');

process.stdout.write(output + '\n');
