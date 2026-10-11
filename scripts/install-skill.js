// Installs the /learn skill into ~/.claude/skills so it works in every Claude
// Code session on this machine, pointed at a Slipbox server.
//
//   SLIPBOX_URL=https://notes.example.com npm run install-skill
//
// The API key is never written into the skill. Keep it in
// ~/.config/slipbox/curl.cfg as:  header = "Authorization: Bearer <key>"
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const url = (process.env.SLIPBOX_URL ?? 'http://localhost:4747').replace(/\/+$/, '');
const template = fs.readFileSync(path.join(root, 'claude', 'skills', 'learn', 'SKILL.md'), 'utf8');
const dest = path.join(os.homedir(), '.claude', 'skills', 'learn', 'SKILL.md');

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, template.replaceAll('{{SLIPBOX_URL}}', url));
console.log(`Installed the /learn skill to ${dest}`);
console.log(`It saves notes to ${url}`);

const cfg = path.join(os.homedir(), '.config', 'slipbox', 'curl.cfg');
if (!fs.existsSync(cfg)) {
  console.log(`\nNext: create ${cfg} (chmod 600) containing:\n  header = "Authorization: Bearer <your key>"`);
}
