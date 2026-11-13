// Syntax-checks every JavaScript file in assets/js, so a new file can never be left out of `npm run check`.
import { accessSync, readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const directory = 'assets/js';
const files = readdirSync(directory).filter(name => name.endsWith('.js')).sort();
const failures = [];

for (const name of files) {
  const result = spawnSync(process.execPath, ['--check', join(directory, name)], { encoding: 'utf8' });
  if (result.status !== 0) failures.push({ name, output: (result.stderr || result.stdout).trim() });
}

if (failures.length) {
  for (const { name, output } of failures) console.error(`Syntax error in ${directory}/${name}\n${output}\n`);
  process.exit(1);
}
try {
  accessSync('music-studio/index.html');
} catch {
  console.error('Missing built music studio at music-studio/index.html.');
  process.exit(1);
}
console.log(`Syntax OK: ${files.length} files in ${directory}.`);
