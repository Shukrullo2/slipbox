// Builds a ready-to-install copy of the "slipbox" skill (SKILL.md + slipbox.py)
// with the server address and an API key filled in, for a machine that can't
// use connectors. Output: ~/Desktop/slipbox-skill/slipbox/ and slipbox-skill.zip.
//
//   node scripts/package-skill.js [CREDENTIALS_NAME]
//
// The key is read from ~/.config/slipbox/credentials (default name
// SLIPBOX_WORK_LAPTOP_KEY) so it never has to be typed or printed.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const credsFile = path.join(os.homedir(), '.config', 'slipbox', 'credentials');
const creds = Object.fromEntries(
  fs
    .readFileSync(credsFile, 'utf8')
    .split('\n')
    .filter((l) => /^[A-Z_]+=/.test(l))
    .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
);
const keyName = process.argv[2] ?? 'SLIPBOX_WORK_LAPTOP_KEY';
const key = creds[keyName];
const url = creds.SLIPBOX_URL;
if (!key || !url) {
  console.error(`${credsFile} needs SLIPBOX_URL and ${keyName}.`);
  process.exit(1);
}

const out = path.join(os.homedir(), 'Desktop', 'slipbox-skill');
const dir = path.join(out, 'slipbox');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
for (const file of ['SKILL.md', 'slipbox.py']) {
  const text = fs
    .readFileSync(path.join(root, 'claude', 'skills', 'slipbox', file), 'utf8')
    .replaceAll('{{SLIPBOX_URL}}', url)
    .replaceAll('{{SLIPBOX_API_KEY}}', key);
  fs.writeFileSync(path.join(dir, file), text, { mode: 0o600 });
}
execFileSync('zip', ['-q', '-r', 'slipbox-skill.zip', 'slipbox'], { cwd: out });
fs.chmodSync(path.join(out, 'slipbox-skill.zip'), 0o600);
console.log(`Built ${dir} and ${path.join(out, 'slipbox-skill.zip')} (key: ${keyName})`);
