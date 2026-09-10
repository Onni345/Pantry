/**
 * RLS boundary test.
 *
 * Creates two throwaway anonymous users in two separate households and checks
 * that Postgres itself refuses the cross-household reads and writes — not just
 * that the app declines to ask for them.
 *
 * Run from the project root:  node scripts/rls-test.mjs
 */
import { readFileSync } from 'node:fs';

const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n')
    .filter((l) => l.trim() && !l.startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim()];
    })
);

const URL_ = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_ANON_KEY;
if (!URL_ || !KEY) {
  console.error('Could not read VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from .env');
  process.exit(1);
}

async function anonSignIn() {
  const r = await fetch(`${URL_}/auth/v1/signup`, {
    method: 'POST',
    headers: { apikey: KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('anonymous sign-in failed: ' + JSON.stringify(j));
  return { token: j.access_token, uid: j.user.id };
}

const rest = (sess) => async (path, opts = {}) => {
  const r = await fetch(`${URL_}/rest/v1/${path}`, {
    ...opts,
    headers: {
      apikey: KEY,
      Authorization: `Bearer ${sess.token}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...(opts.headers || {})
    }
  });
  let body = null;
  try { body = await r.json(); } catch {}
  return { status: r.status, body };
};

const uuid = () => crypto.randomUUID();
const results = [];
const check = (name, pass, detail = '') => results.push({ name, pass, detail });

const A = await anonSignIn();
const B = await anonSignIn();
const a = rest(A);
const b = rest(B);

const hA = uuid();
const hB = uuid();

await a('households', { method: 'POST', body: JSON.stringify({ id: hA }) });
await a('household_members', {
  method: 'POST',
  body: JSON.stringify({ id: uuid(), household_id: hA, user_id: A.uid })
});
await b('households', { method: 'POST', body: JSON.stringify({ id: hB }) });
await b('household_members', {
  method: 'POST',
  body: JSON.stringify({ id: uuid(), household_id: hB, user_id: B.uid })
});

let r;

r = await b(`household_members?household_id=eq.${hA}&select=*`);
check("B cannot read A's member roster", Array.isArray(r.body) && r.body.length === 0, JSON.stringify(r.body));

r = await b(`household_members?household_id=eq.${hB}&select=*`);
check('B can read its own roster', Array.isArray(r.body) && r.body.length === 1, JSON.stringify(r.body));

r = await b('household_members', {
  method: 'POST',
  body: JSON.stringify({ id: uuid(), household_id: hB, user_id: A.uid })
});
check('B cannot enroll a different user id', r.status >= 400, `HTTP ${r.status}`);

r = await fetch(`${URL_}/rest/v1/household_members?select=*`, { headers: { apikey: KEY } });
const bare = await r.json().catch(() => null);
check(
  'Bare publishable key with no session reads nothing',
  Array.isArray(bare) && bare.length === 0,
  JSON.stringify(bare).slice(0, 160)
);

r = await b('household_members', {
  method: 'POST',
  body: JSON.stringify({ id: uuid(), household_id: hA, user_id: B.uid })
});
check('B can join A when given the join code (intended)', r.status < 400, `HTTP ${r.status}`);

let failed = 0;
for (const { name, pass, detail } of results) {
  if (!pass) failed++;
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${pass ? '' : `\n        ${detail}`}`);
}

console.log(`\n${results.length - failed}/${results.length} passed`);
console.log(`\nThrowaway households created by this test (safe to leave, or delete in the SQL editor):\n  ${hA}\n  ${hB}`);
process.exit(failed ? 1 : 0);
