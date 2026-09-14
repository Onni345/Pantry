/**
 * Runs every *.test.mjs beside this file and fails the run if any does.
 *
 * These are plain Node scripts on purpose: the modules under test are pure
 * (no React, no Dexie, no fetch), so they need no test runner, and a
 * dependency-free check is one that still runs in two years.
 */
import { readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';

const here = new URL('.', import.meta.url).pathname;
const files = (await readdir(here)).filter((f) => f.endsWith('.test.mjs')).sort();

let failed = 0;
for (const f of files) {
  console.log(`\n── ${f} ${'─'.repeat(Math.max(0, 50 - f.length))}`);
  const r = spawnSync(process.execPath, [here + f], { stdio: 'inherit' });
  if (r.status !== 0) failed++;
}

console.log(failed ? `\n${failed} test file(s) failed` : `\nall ${files.length} test files passed`);
process.exit(failed ? 1 : 0);
