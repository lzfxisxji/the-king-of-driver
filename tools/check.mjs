import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'src');
const out = path.join(root, 'tools', '_check');
fs.mkdirSync(out, { recursive: true });
let bad = 0;
const lines = [];
for (const f of fs.readdirSync(dir)) {
  if (!f.endsWith('.js')) continue;
  const dst = path.join(out, f.replace(/\.js$/, '.mjs'));
  fs.copyFileSync(path.join(dir, f), dst);
  try {
    execFileSync(process.execPath, ['--check', dst], { stdio: 'pipe' });
    lines.push('OK   ' + f);
  } catch (e) {
    bad++;
    lines.push('FAIL ' + f + '\n' + (e.stderr ? e.stderr.toString() : e.message));
  }
}
fs.writeFileSync(path.join(root, 'tools', 'syntax.log'), lines.join('\n'), 'utf8');
console.log(lines.join('\n'));
process.exit(bad ? 1 : 0);
