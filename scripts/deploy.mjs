/**
 * Put Kitchen on the internet, in one command.
 *
 * The manual version is eight commands with a "copy this id out of that output
 * and paste it into that file" step in the middle, which is the step people
 * lose an evening to. This does the same things in the same order, skips
 * whatever already exists, and can be re-run safely as many times as you like.
 *
 *   npm run deploy:setup
 *
 * Everything it does, it does through the same `wrangler` commands the README
 * lists — so if it ever falls over, the manual path still works and you have
 * lost nothing.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { randomBytes } from 'node:crypto';

const CONFIG = 'wrangler.toml';
const DB_NAME = 'kitchen';
const BUCKET = 'kitchen-photos';
const SECRETS = ['HOUSEHOLD_PASSCODE', 'SESSION_SECRET', 'ANTHROPIC_API_KEY'];

const c = {
  bold: (s) => `[1m${s}[0m`,
  dim: (s) => `[2m${s}[0m`,
  green: (s) => `[32m${s}[0m`,
  amber: (s) => `[33m${s}[0m`,
  red: (s) => `[31m${s}[0m`,
};

const NPX = process.platform === 'win32' ? 'npx.cmd' : 'npx';

function wrangler(args, { input, quiet = true } = {}) {
  return spawnSync(NPX, ['wrangler', ...args], {
    encoding: 'utf8',
    input,
    stdio: ['pipe', quiet ? 'pipe' : 'inherit', 'pipe'],
  });
}

function die(message, detail) {
  console.error(`\n${c.red('✗')} ${message}`);
  if (detail) console.error(c.dim(String(detail).trim().split('\n').slice(-12).join('\n')));
  process.exit(1);
}

function step(n, total, label) {
  console.log(`\n${c.dim(`[${n}/${total}]`)} ${c.bold(label)}`);
}

/* ------------------------------------------------------------- prompting --- */

function ask(question, { secret = false } = {}) {
  if (!process.stdin.isTTY) {
    die('This needs an interactive terminal — it has to ask you for the secrets.');
  }

  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });

    if (secret) {
      // Stop the value echoing as it's typed; readline still receives it.
      const onData = (char) => {
        if (['\n', '\r', ''].includes(String(char))) process.stdin.removeListener('data', onData);
        else process.stdout.write('[2K[200D' + question + '*'.repeat(rl.line.length));
      };
      process.stdin.on('data', onData);
    }

    rl.question(question, (answer) => {
      if (secret) process.stdout.write('\n');
      rl.close();
      resolve(answer.trim());
    });
  });
}

/* ----------------------------------------------------------------- steps --- */

function checkLogin() {
  const result = wrangler(['whoami']);
  const output = `${result.stdout || ''}${result.stderr || ''}`.replace(/\[[0-9;]*m/g, '');

  // `whoami` exits 0 whether or not you're signed in — it just says so in the
  // output. Trusting the exit code lets the run limp on and fail two steps
  // later with a message about the database, which is no help at all.
  if (result.status !== 0 || /not authenticated/i.test(output)) {
    die('Not signed in to Cloudflare yet.',
      'Run this, then try again:\n\n  npx wrangler login\n\n'
      + "It opens a browser. If you don't have an account yet, make a free one\n"
      + 'at https://dash.cloudflare.com/sign-up first — no card needed.');
  }

  const email = /([\w.+-]+@[\w.-]+)/.exec(output)?.[1];
  console.log(`${c.green('✓')} Signed in to Cloudflare${email ? c.dim(` as ${email}`) : ''}`);
}

/** Find the database, creating it the first time. Returns its id. */
function ensureDatabase() {
  const find = () => {
    const result = wrangler(['d1', 'list', '--json']);
    if (result.status !== 0) return null;
    try {
      const list = JSON.parse(result.stdout);
      return list.find((db) => db.name === DB_NAME)?.uuid || null;
    } catch {
      return null;
    }
  };

  let id = find();
  if (id) {
    console.log(`${c.green('✓')} Database ${c.dim(DB_NAME + ' already exists')}`);
    return id;
  }

  const created = wrangler(['d1', 'create', DB_NAME]);
  if (created.status !== 0) {
    die(`Could not create the "${DB_NAME}" database.`, created.stderr || created.stdout);
  }

  // Read it back rather than scraping the create output, which changes format.
  id = find() || /database_id\s*=\s*"([0-9a-f-]{36})"/.exec(created.stdout)?.[1];
  if (!id) die('Created the database but could not work out its id.', created.stdout);

  console.log(`${c.green('✓')} Database created`);
  return id;
}

/** The step everyone gets wrong by hand. */
function writeDatabaseId(id) {
  if (!existsSync(CONFIG)) die(`${CONFIG} is missing — are you in the project folder?`);

  const before = readFileSync(CONFIG, 'utf8');
  const after = before.replace(
    /^(\s*database_id\s*=\s*)"[^"]*"/m,
    (_, prefix) => `${prefix}"${id}"`,
  );

  if (after === before) {
    if (before.includes(`"${id}"`)) {
      console.log(`${c.green('✓')} ${CONFIG} already points at it`);
      return;
    }
    die(`Could not find a database_id line to update in ${CONFIG}.`);
  }

  writeFileSync(CONFIG, after);
  console.log(`${c.green('✓')} Wrote the id into ${CONFIG} ${c.dim('(commit this)')}`);
}

function ensureBucket() {
  const result = wrangler(['r2', 'bucket', 'create', BUCKET]);
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  if (result.status === 0) {
    console.log(`${c.green('✓')} Photo bucket created`);
    return;
  }
  if (/already (exists|owned)/i.test(output)) {
    console.log(`${c.green('✓')} Photo bucket ${c.dim(BUCKET + ' already exists')}`);
    return;
  }
  die('Could not create the photo bucket.', output);
}

function createTables() {
  const result = wrangler(['d1', 'execute', DB_NAME, '--remote', '--file=./schema.sql', '-y']);
  if (result.status !== 0) {
    die('Could not create the tables.', result.stderr || result.stdout);
  }
  // schema.sql is all CREATE TABLE IF NOT EXISTS, so re-running changes nothing.
  console.log(`${c.green('✓')} Tables ready`);
}

function existingSecrets() {
  const result = wrangler(['secret', 'list', '--format', 'json']);
  if (result.status !== 0) return [];
  try {
    return JSON.parse(result.stdout).map((s) => s.name);
  } catch {
    return [];
  }
}

async function ensureSecrets() {
  const already = existingSecrets();
  const missing = SECRETS.filter((name) => !already.includes(name));

  if (already.length) {
    console.log(`  ${c.dim('already set: ' + already.join(', '))}`);
  }
  if (!missing.length) {
    console.log(`${c.green('✓')} All three secrets are set`);
    return;
  }

  for (const name of missing) {
    let value;

    if (name === 'HOUSEHOLD_PASSCODE') {
      console.log(`\n  ${c.bold('The passcode')} — you and your partner both type this to get in.`);
      value = await ask('  Passcode: ', { secret: true });
      while (!value) value = await ask('  Passcode (it cannot be blank): ', { secret: true });
    }

    if (name === 'SESSION_SECRET') {
      // Nobody ever types this one, so there is no reason to make them invent it.
      value = randomBytes(32).toString('base64');
      console.log(`\n  ${c.bold('Session secret')} — generated for you ${c.dim('(signs the login cookie)')}`);
    }

    if (name === 'ANTHROPIC_API_KEY') {
      console.log(`\n  ${c.bold('Anthropic API key')} — reads photos and reel captions.`);
      console.log(`  ${c.dim('Leave blank to skip; everything else works, and you can add it later')}`);
      console.log(`  ${c.dim('with: npx wrangler secret put ANTHROPIC_API_KEY')}`);
      value = await ask('  Key (or Enter to skip): ', { secret: true });
      if (!value) {
        console.log(`  ${c.amber('!')} Skipped — photo and reel importing will be off.`);
        continue;
      }
    }

    const result = wrangler(['secret', 'put', name], { input: `${value}\n` });
    if (result.status !== 0) {
      die(`Could not set ${name}.`, result.stderr || result.stdout);
    }
    console.log(`  ${c.green('✓')} ${name} set`);
  }
}

function deploy() {
  const result = wrangler(['deploy']);
  const output = `${result.stdout || ''}${result.stderr || ''}`;

  if (result.status !== 0) die('The deploy failed.', output);

  const url = /(https:\/\/[^\s]*\.workers\.dev)/.exec(output)?.[1];
  console.log(`${c.green('✓')} Deployed`);
  return url;
}

/* ------------------------------------------------------------------ run --- */

console.log(c.bold('\nPutting Kitchen on the internet.\n')
  + c.dim('Safe to re-run — anything already done gets skipped.'));

step(1, 6, 'Checking your Cloudflare login');
checkLogin();

step(2, 6, 'Database');
writeDatabaseId(ensureDatabase());

step(3, 6, 'Photo storage');
ensureBucket();

step(4, 6, 'Tables');
createTables();

step(5, 6, 'Secrets');
await ensureSecrets();

step(6, 6, 'Deploying');
const url = deploy();

console.log(`
${c.green(c.bold('Done.'))}
${url ? `\n  ${c.bold(url)}\n` : '\n  The URL is in the output above.\n'}
Open it, type your passcode, put your name in. Then send that link and the
passcode to your partner and they do the same with their own name.

${c.dim('To put it on your home screen and share reels into it, see')}
${c.dim('"Putting it on your home screen" in the README.')}

${c.dim('From now on, shipping a change is just: npm run deploy')}
`);
