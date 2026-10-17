#!/usr/bin/env node
// No dependencies, root access, Docker daemon, or production paths required.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { test } = require('node:test');

const script = path.join(__dirname, 'benefits-backend-volume-ownership.sh');
// Only privilege/ownership and Docker are modeled; find, tar, chmod, df and
// the actual fixture files are real. stat also adapts GNU formatting on macOS.
const shim = `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const state = JSON.parse(fs.readFileSync(process.env.TEST_STATE, 'utf8'));
const volume = process.env.BENEFITS_VOLUME_PATH;
const save = () => fs.writeFileSync(process.env.TEST_STATE, JSON.stringify(state));
const fail = () => process.exit(1);
fs.appendFileSync(process.env.TEST_LOG, JSON.stringify([command, ...args]) + '\\n');
if (command === 'docker') {
  if (args[0] === 'volume' && args[1] === 'inspect') console.log(volume);
  else if (args[0] === 'ps') console.log(process.env.BAD_CONSUMER ? 'other-service' : 'inferno-benefits-backend');
  else if (args[0] === 'inspect') {
    const format = args[2];
    if (format.includes('.Mounts')) console.log(process.env.BAD_MOUNT ? 'bind||/other' : 'volume|' + (process.env.TEST_VOLUME_NAME || 'inferno_benefits_data') + '|' + volume);
    else if (format.includes('.Config.Labels')) console.log('benefits-backend');
    else if (format === '{{.State.Status}}') console.log(state.running ? 'running' : 'exited');
    else throw Error('unexpected inspect format');
  } else if (JSON.stringify(args) === JSON.stringify(['stop', '--time', '60', 'inferno-benefits-backend'])) {
    if (process.env.FAIL_STOP) fail();
    state.running = false; save();
  } else throw Error('unexpected Docker call: ' + args);
} else if (command === 'stat') {
  const target = args.at(-1), st = fs.lstatSync(target);
  const owner = state.owners[target] || [0, 0];
  const values = { u: owner[0], g: owner[1], a: (st.mode & 0o7777).toString(8), d: st.dev, h: st.nlink };
  console.log(args[1].replace(/%([ugadh])/g, (_, key) => values[key]));
} else if (command === 'id') console.log(process.env.TEST_OPERATOR_UID || '0');
else if (command === 'date') console.log('20261016T120000Z');
else if (command === 'flock') { if (process.env.FAIL_LOCK) fail(); }
else if (command === 'chown') {
  if (state.running) throw Error('chown attempted while backend running');
  if (process.env.FAIL_CHOWN) fail();
  const expected = ['-R', '--no-dereference', '--preserve-root', '--', '1000:1000', volume];
  if (JSON.stringify(args) !== JSON.stringify(expected)) throw Error('unexpected chown arguments');
  function walk(target) {
    const st = fs.lstatSync(target);
    if (!process.env.LIE_CHOWN) state.owners[target] = [1000, 1000];
    // chown can clear setuid/setgid bits; the tool must restore them.
    fs.chmodSync(target, st.mode & 0o1777);
    if (st.isDirectory()) for (const name of fs.readdirSync(target)) walk(path.join(target, name));
  }
  walk(volume); save();
} else if (command === 'sha256sum') {
  if (args[0] === '--check') {
    if (process.env.FAIL_CHECKSUM) fail();
    const line = fs.readFileSync(args.at(-1), 'utf8').trimEnd();
    const digest = line.slice(0, 64), target = line.slice(66);
    if (digest !== createHash('sha256').update(fs.readFileSync(target)).digest('hex')) fail();
  } else console.log(createHash('sha256').update(fs.readFileSync(args[0])).digest('hex') + '  ' + args[0]);
} else if (command === 'tar') {
  if (process.env.FAIL_TAR) fail();
  if (process.env.FAIL_FINAL_TAR && args.includes('--create') && !args[args.indexOf('--file') + 1].includes('-prestop')) fail();
  const result = spawnSync('/usr/bin/tar', args, { stdio: 'inherit' });
  process.exit(result.status ?? 1);
} else throw Error('unexpected shim command');
`;

function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'benefits-ownership-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const volume = path.join(root, 'volume with spaces');
  const backups = path.join(root, 'backups');
  const bin = path.join(root, 'bin');
  for (const directory of [volume, backups, bin]) fs.mkdirSync(directory, { mode: 0o700 });
  fs.mkdirSync(path.join(volume, 'nested'), { mode: 0o750 });
  fs.writeFileSync(path.join(volume, 'benefits.db'), 'private-fixture-database', { mode: 0o640 });
  fs.writeFileSync(path.join(volume, 'benefits.db-wal'), 'fixture-wal', { mode: 0o600 });
  fs.writeFileSync(path.join(volume, 'nested', 'line\nbreak.sqlite'), 'fixture-newline', { mode: 0o600 });
  const shimPath = path.join(root, 'shim.cjs');
  fs.writeFileSync(shimPath, shim, { mode: 0o755 });
  for (const command of ['docker', 'stat', 'id', 'flock', 'chown', 'sha256sum', 'tar', 'date']) {
    fs.symlinkSync(shimPath, path.join(bin, command));
  }
  const statePath = path.join(root, 'state.json');
  const logPath = path.join(root, 'calls.jsonl');
  fs.writeFileSync(statePath, JSON.stringify({ running: true, owners: { [path.join(volume, 'benefits.db')]: [0, 123] } }));
  fs.writeFileSync(logPath, '');
  const env = {
    ...process.env, LC_ALL: 'C', PATH: `${bin}:${process.env.PATH}`, BENEFITS_OWNERSHIP_TEST_MODE: '1',
    BENEFITS_VOLUME_PATH: volume, BENEFITS_BACKUP_DIR: backups, TEST_STATE: statePath, TEST_LOG: logPath,
  };
  const run = (mode, extra = {}) => {
    const result = spawnSync('bash', [script, mode], { env: { ...env, ...extra }, encoding: 'utf8' });
    assert.equal(result.error, undefined);
    assert.ok(!`${result.stdout}${result.stderr}`.includes('private-fixture-database'), 'must not log file contents');
    return result;
  };
  const calls = () => fs.readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  const state = () => JSON.parse(fs.readFileSync(statePath, 'utf8'));
  return { root, volume, backups, statePath, logPath, env, run, calls, state };
}

function snapshot(directory) {
  const result = {};
  function walk(target) {
    const st = fs.lstatSync(target);
    result[target] = [st.uid, st.gid, st.mode, st.mtimeMs, st.ctimeMs,
      st.isFile() ? fs.readFileSync(target).toString('hex') : null];
    if (st.isDirectory()) for (const name of fs.readdirSync(target).sort()) walk(path.join(target, name));
  }
  walk(directory);
  return result;
}

test('plan reports all metadata, uid counts, SQLite, disk and running state without writes', t => {
  const f = fixture(t), before = snapshot(f.volume), state = f.state();
  const result = f.run('plan');
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(snapshot(f.volume), before);
  assert.deepEqual(f.state(), state);
  assert.deepEqual(fs.readdirSync(f.backups), []);
  assert.match(result.stdout, /Entries by uid/);
  assert.match(result.stdout, /0:123 640/);
  assert.match(result.stdout, /SQLite files[\s\S]*benefits\.db-wal/);
  assert.match(result.stdout, /Free disk/);
  assert.match(result.stdout, /backend \(running\)/);
  assert.match(result.stdout, /Apply would change 5 entries/);
  assert.match(result.stdout, /DEPLOY_MODE=gate EXPECTED_SHA=/);
  assert.ok(f.calls().every(call => ['docker', 'stat'].includes(call[0])));
});

test('apply refuses without working tar backup before stopping or chowning', t => {
  const f = fixture(t), before = snapshot(f.volume);
  const result = f.run('apply', { FAIL_TAR: '1' });
  assert.equal(result.status, 73, result.stderr);
  assert.equal(f.state().running, true);
  assert.deepEqual(snapshot(f.volume), before);
  assert.ok(!f.calls().some(c => c[0] === 'chown' || c[1] === 'stop'));
});

test('apply refuses failed checksum verification before stopping', t => {
  const f = fixture(t);
  assert.equal(f.run('apply', { FAIL_CHECKSUM: '1' }).status, 73);
  assert.equal(f.state().running, true);
  assert.ok(!f.calls().some(c => c[0] === 'chown'));
});

test('apply refuses an unavailable backup directory before stopping', t => {
  const f = fixture(t), target = path.join(f.root, 'not-a-directory');
  fs.writeFileSync(target, 'fixture');
  const result = f.run('apply', { BENEFITS_BACKUP_DIR: target });
  assert.equal(result.status, 73, result.stderr);
  assert.equal(f.state().running, true);
  assert.ok(!f.calls().some(c => c[0] === 'chown' || c[1] === 'stop'));
});

test('a failed prior backup cannot be reused or overwritten on retry', t => {
  const f = fixture(t);
  assert.equal(f.run('apply', { FAIL_TAR: '1' }).status, 73);
  const backups = snapshot(f.backups);
  fs.writeFileSync(f.logPath, '');
  assert.equal(f.run('apply').status, 73);
  assert.deepEqual(snapshot(f.backups), backups);
  assert.equal(f.state().running, true);
  assert.ok(!f.calls().some(c => c[0] === 'chown' || c[1] === 'stop' || c[0] === 'tar'));
});

test('apply backs up before stop and after stop, chowns, preserves all modes, and leaves stopped', t => {
  const f = fixture(t);
  fs.chmodSync(path.join(f.volume, 'nested'), 0o2750);
  fs.chmodSync(path.join(f.volume, 'benefits.db'), 0o4640);
  const before = snapshot(f.volume), result = f.run('apply');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SUCCESS/);
  assert.equal(f.state().running, false);
  for (const [target, [uid, gid]] of Object.entries(f.state().owners)) {
    assert.equal(uid, 1000, target); assert.equal(gid, 1000, target);
  }
  assert.equal(Object.keys(f.state().owners).length, Object.keys(before).length);
  assert.deepEqual(snapshot(f.volume), Object.fromEntries(Object.entries(before).map(([target, values]) => {
    const current = snapshot(f.volume)[target];
    // ctime changes on chown/chmod; content, mode and mtime must not change.
    return [target, values.map((value, i) => i === 4 ? current[4] : value)];
  })));
  const calls = f.calls(), stop = calls.findIndex(c => c[1] === 'stop');
  const creates = calls.map((c, i) => c[0] === 'tar' && c.includes('--create') ? i : -1).filter(i => i >= 0);
  assert.equal(creates.length, 2);
  assert.ok(creates[0] < stop && stop < creates[1] && creates[1] < calls.findIndex(c => c[0] === 'chown'));
  assert.deepEqual(calls.filter(c => c[1] === 'stop'), [['docker', 'stop', '--time', '60', 'inferno-benefits-backend']]);
  assert.ok(!calls.some(c => c[0] === 'docker' && ['start', 'compose', 'restart'].includes(c[1])));
  const archives = fs.readdirSync(f.backups).filter(name => name.endsWith('.tar'));
  assert.equal(archives.length, 2);
  for (const name of archives) {
    const archive = path.join(f.backups, name);
    assert.equal(fs.statSync(archive).mode & 0o777, 0o600);
    assert.equal(fs.statSync(`${archive}.sha256`).mode & 0o777, 0o600);
    assert.ok(fs.readFileSync(`${archive}.sha256`, 'utf8').startsWith(createHash('sha256').update(fs.readFileSync(archive)).digest('hex')));
    const contents = spawnSync('/usr/bin/tar', ['-xOf', archive, './benefits.db'], { encoding: 'utf8' });
    assert.equal(contents.status, 0, contents.stderr);
    assert.equal(contents.stdout, 'private-fixture-database');
  }
});

test('second apply is a no-op: no new backups, stops or chown', t => {
  const f = fixture(t);
  assert.equal(f.run('apply').status, 0);
  const before = snapshot(f.volume), backups = snapshot(f.backups);
  fs.writeFileSync(f.logPath, '');
  const result = f.run('apply');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /NO-OP/);
  assert.deepEqual(snapshot(f.volume), before);
  assert.deepEqual(snapshot(f.backups), backups);
  assert.ok(!f.calls().some(c => ['chown', 'tar', 'sha256sum'].includes(c[0]) || c[1] === 'stop'));
});

test('failed stopped-backend backup leaves backend stopped and ownership untouched', t => {
  const f = fixture(t), owners = f.state().owners;
  assert.equal(f.run('apply', { FAIL_FINAL_TAR: '1' }).status, 73);
  assert.equal(f.state().running, false);
  assert.deepEqual(f.state().owners, owners);
  assert.ok(!f.calls().some(c => c[0] === 'chown'));
});

for (const [label, extra, status] of [
  ['wrong mount', { BAD_MOUNT: '1' }, 78],
  ['other volume consumer', { BAD_CONSUMER: '1' }, 78],
  ['non-root operator', { TEST_OPERATOR_UID: '501' }, 77],
  ['concurrent apply', { FAIL_LOCK: '1' }, 75],
  ['failed stop', { FAIL_STOP: '1' }, 74],
  ['failed chown', { FAIL_CHOWN: '1' }, 74],
  ['ownership verification failure', { LIE_CHOWN: '1' }, 74],
]) {
  test(`apply fails closed: ${label}`, t => {
    const f = fixture(t), result = f.run('apply', extra);
    assert.equal(result.status, status, `${result.stdout}\n${result.stderr}`);
    assert.ok(!f.calls().some(c => c[0] === 'docker' && ['start', 'restart', 'compose'].includes(c[1])));
  });
}

test('symlinks are refused without changing an outside target', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside');
  fs.writeFileSync(outside, 'outside');
  fs.symlinkSync(outside, path.join(f.volume, 'link'));
  const before = snapshot(outside);
  assert.equal(f.run('apply').status, 78);
  assert.deepEqual(snapshot(outside), before);
  assert.equal(f.state().running, true);
});

test('hard links are refused without changing an outside target', t => {
  const f = fixture(t), outside = path.join(f.root, 'outside');
  fs.writeFileSync(outside, 'outside');
  fs.linkSync(outside, path.join(f.volume, 'hard-link'));
  const before = snapshot(outside);
  assert.equal(f.run('apply').status, 78);
  assert.deepEqual(snapshot(outside), before);
  assert.equal(f.state().running, true);
});

test('test path overrides require an explicit test-mode guard', t => {
  const f = fixture(t);
  assert.equal(f.run('apply', { BENEFITS_OWNERSHIP_TEST_MODE: '' }).status, 64);
  assert.deepEqual(f.calls(), []);
});

test('resolves a non-default Docker volume name from the container mount', t => {
  const f = fixture(t);
  const result = f.run('plan', { TEST_VOLUME_NAME: 'custom-project_benefits-data' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(f.calls().some(c => c[1] === 'volume' && c.at(-1) === 'custom-project_benefits-data'));
});
