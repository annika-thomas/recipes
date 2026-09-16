/**
 * Get Kitchen running on this machine, with nothing to sign up for.
 *
 * A local run needs two things the repo can't carry: a `.dev.vars` file with a
 * passcode and a cookie-signing secret, and a local SQLite copy of the schema.
 * This makes both. It never overwrites an existing `.dev.vars` — if you've put
 * a real API key in there, it stays.
 *
 *   npm run setup
 */

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';

const FILE = '.dev.vars';

const c = {
  bold: (s) => `[1m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  amber: (s) => `[33m${s}[0m`,
};

async function ask(question, fallback) {
  // Non-interactive (CI, a piped shell): take the default rather than hang.
  if (!process.stdin.isTTY) return fallback;

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = (await rl.question(question)).trim();
    return answer || fallback;
  } finally {
    rl.close();
  }
}

async function writeDevVars() {
  if (existsSync(FILE)) {
    const existing = readFileSync(FILE, 'utf8');
    const hasKey = /^ANTHROPIC_API_KEY=\S/m.test(existing);
    console.log(`${c.green('✓')} ${FILE} already exists — leaving it alone.`);
    if (!hasKey) {
      console.log(`  ${c.dim('No ANTHROPIC_API_KEY in it, so photo and reel importing will be off.')}`);
      console.log(`  ${c.dim('Add one line to ' + FILE + ' when you want it: ANTHROPIC_API_KEY=sk-ant-...')}`);
    }
    return;
  }

  console.log(c.bold('\nSetting up a local Kitchen.\n'));

  const passcode = await ask(
    `  Passcode for signing in locally ${c.dim('[kitchen]')}: `,
    'kitchen',
  );
  const apiKey = await ask(
    `  Anthropic API key, for reading photos and reels ${c.dim('[skip for now]')}: `,
    '',
  );

  const lines = [
    '# Local-only secrets. Git ignores this file; it never reaches Cloudflare.',
    '# Deployed, the same three values are set with `npx wrangler secret put NAME`.',
    '',
    `HOUSEHOLD_PASSCODE=${passcode}`,
    `SESSION_SECRET=${randomBytes(32).toString('base64')}`,
    apiKey ? `ANTHROPIC_API_KEY=${apiKey}` : '# ANTHROPIC_API_KEY=sk-ant-...',
    '',
  ];

  writeFileSync(FILE, lines.join('\n'), { mode: 0o600 });
  console.log(`\n${c.green('✓')} Wrote ${FILE} ${c.dim('(passcode: ' + passcode + ')')}`);
  if (!apiKey) {
    console.log(`  ${c.amber('!')} No API key, so importing from photos and reels is off for now.`);
    console.log(`  ${c.dim('Typing recipes in works, and so do most recipe-site links.')}`);
    console.log(`  ${c.dim('To turn it on later, uncomment the ANTHROPIC_API_KEY line in ' + FILE + '.')}`);
  }
}

function initDatabase() {
  console.log(`\n${c.dim('Creating the local database…')}`);

  const result = spawnSync(
    process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['wrangler', 'd1', 'execute', 'kitchen', '--local', '--file=./schema.sql'],
    { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' },
  );

  if (result.status !== 0) {
    console.error(`\n${c.amber('!')} Could not create the local database.\n`);
    console.error(result.stderr || result.stdout || '(no output)');
    console.error(`\nTry it by hand: ${c.bold('npx wrangler d1 execute kitchen --local --file=./schema.sql')}`);
    process.exit(1);
  }

  console.log(`${c.green('✓')} Database ready ${c.dim('(.wrangler/state — delete that folder to start over)')}`);
}

await writeDevVars();
initDatabase();

console.log(`
${c.green('Ready.')} Start it with:

  ${c.bold('npm run dev')}

then open ${c.bold('http://localhost:8787')} and sign in with the passcode above.

${c.dim('Everything stays on this machine — no Cloudflare account needed until you')}
${c.dim('deploy it for both phones. See "Going live" in the README for that.')}
`);
