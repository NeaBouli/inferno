#!/usr/bin/env node
// Real temporary Git archives, SQLite migration SQL, rsync, backups and invariants.
// Docker, privilege/ownership and HTTP are modeled; no daemon/network/root needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { test } = require('node:test');
const { createHash } = require('node:crypto');
const filename = 'benefits-migration-model-b-period-dedup.sh';
const source = fs.readFileSync(path.join(__dirname, filename), 'utf8');
const migration = '20261017120000_model_b_period_dedup';
const sql = fs.readFileSync(path.join(__dirname, '../../apps/benefits-network/backend/prisma/migrations', migration, 'migration.sql'), 'utf8');
const secret = 'PRIVATE_SENTINEL_MUST_NEVER_APPEAR';
const image = letter => 'sha256:' + letter.repeat(64);

function command(name, args, options = {}) {
  const result = spawnSync(name, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${name}: ${result.stderr}`);
  return result.stdout.trim();
}

const shim = String.raw`#!/usr/bin/env python3
import hashlib, json, os, pathlib, sqlite3, sys
cmd=pathlib.Path(sys.argv[0]).name; a=sys.argv[1:]; e=os.environ
state_path=pathlib.Path(e['TEST_STATE']); s=json.loads(state_path.read_text())
def save(): state_path.write_text(json.dumps(s))
def img(c): return 'sha256:'+c*64
def fail(): sys.exit(1)
with open(e['TEST_LOG'],'a') as f: f.write(json.dumps([cmd,*a])+'\n')
print(e['TEST_SECRET'],file=sys.stderr)
if cmd == 'docker':
    if a[0] == 'inspect':
        fmt=a[2]; container=a[-1]; backend=container == 'inferno-benefits-backend'
        if '.Mounts' in fmt: print('volume|custom-project_benefits-data|'+e['BENEFITS_VOLUME_PATH'])
        elif '.Config.Labels' in fmt: print('benefits-backend')
        elif '.State.Health' in fmt: print('true healthy' if s['running'] else 'false unhealthy')
        elif '.State.Running' in fmt: print('true' if s['running'] else 'false')
        elif '.State.ExitCode' in fmt: print('exited '+('1' if e.get('FAIL_MIGRATE') else '0'))
        elif '.State.Status' in fmt: print('running' if s['running'] else 'exited')
        elif fmt == '{{.Id}}': print('id-'+container)
        elif fmt == '{{.Image}}': print(img(('b' if backend else 'c') if s.get('started') else 'a'))
        else: raise Exception('unexpected inspect')
    elif a[0] == 'volume': print(e['BENEFITS_VOLUME_PATH'])
    elif a[0] == 'ps':
        if 'volume=custom-project_benefits-data' in a: print('inferno-benefits-backend')
        elif s.get('oneoff'): print(s['oneoff'])
    elif a[0] == 'image':
        if a[1] == 'tag': s['tags'][a[3]]=a[2]; save()
        elif a[3] == '{{.Config.User}}': print('node')
        else: print(s['tags'].get(a[-1],a[-1]))
    elif a[0] == 'build': print(img('b'))
    elif a[0] == 'create':
        if e.get('FAIL_CREATE'): fail()
        assert a[a.index('--network')+1] == 'none'
        assert a[-3:] == ['prisma','migrate','deploy'] and img('b') in a
        mount=a[a.index('--mount')+1]
        assert not s['running'] or mount.startswith('type=bind,')
        assert s['running'] or s.get('chowned')
        s['oneoff']=a[a.index('--name')+1]
        s['migrationDb']=e['MIGRATION_DB_FILE'] if mount.startswith('type=volume,') else mount.split(',src=')[1].split(',dst=')[0]+'/benefits.db'
        save(); print('oneoff-id')
    elif a[0] == 'start':
        if not e.get('FAIL_MIGRATE') and not e.get('FAIL_WAIT'):
            sql=pathlib.Path(e['TEST_SQL']).read_text(); c=sqlite3.connect(s['migrationDb'])
            c.executescript(sql)
            c.execute('INSERT INTO _prisma_migrations VALUES (?, ?, ?, ?, ?)',('new','${migration}','finished',None,hashlib.sha256(sql.encode()).hexdigest()))
            if e.get('DROP_ROW'): c.execute('DELETE FROM RewardEvent')
            c.commit(); c.close()
    elif a[0] == 'wait':
        if e.get('FAIL_WAIT'): sys.exit(124)
        print('1' if e.get('FAIL_MIGRATE') else '0')
    elif a[0] == 'rm':
        if e.get('FAIL_REMOVE'): fail()
        s.pop('oneoff',None); save()
    elif a[0] == 'exec': print('0' if e.get('BAD_UID') else '1000')
    elif a[0] == 'compose':
        action=next(x for x in a if x in ['config','ps','build','stop','up'])
        if action == 'config':
            backend={'build':{'context':e['MIGRATION_SOURCE_DIR']+'/backend'},'environment':{'DATABASE_URL':'file:/data/benefits.db','CHAIN_ID':'1'},'volumes':[{'target':'/data','source':'benefits-data','type':'volume'}],'image':'fixture-backend:latest'}
            frontend={'build':{'context':e['MIGRATION_SOURCE_DIR']+'/frontend','args':{'NEXT_PUBLIC_CHAIN_ID':'11155111' if e.get('BAD_CHAIN') else '1','BENEFITS_API_INTERNAL_URL':'http://benefits-backend:3001'}},'image':'fixture-frontend:latest'}
            print(json.dumps({'name':'fixture','services':{'benefits-backend':backend,'benefits-frontend':frontend},'volumes':{'benefits-data':{'name':'custom-project_benefits-data'}}}))
        elif action == 'ps':
            if '--all' in a: print('id-inferno-'+a[-1])
            elif s['running']: print('running')
        elif action == 'build':
            assert s['running'], 'built during downtime'
            s['tags'].update({'fixture-backend:latest':img('b'),'fixture-frontend:latest':img('c')}); save()
        elif action == 'stop': s['running']=False; save()
        elif action == 'up':
            assert not s.get('oneoff')
            s['running']=True; s['started']=True; save()
    else: raise Exception('unexpected Docker call')
elif cmd == 'id': print('0')
elif cmd == 'flock': pass
elif cmd == 'stat':
    p=a[-1]; st=os.lstat(p); owner=s['owners'].get(p,[0,0])
    v={'u':str(owner[0]),'g':str(owner[1]),'a':oct(st.st_mode & 0o7777)[2:],'d':str(st.st_dev),'h':str(st.st_nlink)}
    fmt=a[1]
    for key,value in v.items(): fmt=fmt.replace('%'+key,value)
    print(fmt)
elif cmd == 'chown':
    p=a[-1]
    if p == e['BENEFITS_VOLUME_PATH']:
        assert not s['running'], 'chown live volume while serving'
        def walk(p):
            s['owners'][str(p)]=[1000,1000]
            if p.is_dir():
                for child in p.iterdir(): walk(child)
        walk(pathlib.Path(p)); s['chowned']=True; save()
elif cmd == 'curl':
    retired='customer/history' in a[-1] or 'cutover-smoke/redeem' in a[-1]
    sys.stdout.write(('200' if e.get('BAD_SMOKE') else '410') if retired else '200')
elif cmd == 'df': print('Filesystem 1024-blocks Used Available Capacity Mounted on\nfixture 99999999 1 99999999 1% /')
elif cmd == 'sha256sum':
    def digest(f): return hashlib.sha256(pathlib.Path(f).read_bytes()).hexdigest()
    if a and a[0] == '--check':
        for line in pathlib.Path(a[-1]).read_text().strip().split('\n'): assert digest(line[66:]) == line[:64]
    elif not a: print(hashlib.sha256(sys.stdin.buffer.read()).hexdigest()+'  -')
    else:
        for f in a: print(digest(f)+'  '+f)
else: raise Exception('unknown shim')
`;

function fixture(t, variant = '') {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'benefits-model-b-test-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const dirs = Object.fromEntries(['repo', 'tools', 'runtime', 'backups', 'bin', 'volume', 'tmp'].map(k => [k, path.join(root, k + ' with spaces')]));
  for (const d of Object.values(dirs)) fs.mkdirSync(d, { mode: 0o700 });
  const { repo, tools, runtime, backups, bin, volume } = dirs;
  const git = (...args) => command('git', ['-C', repo, ...args]);
  const commit = () => { git('add', '.'); git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'fixture'); return git('rev-parse', 'HEAD'); };
  command('git', ['init', '-q', repo]);
  const app = path.join(repo, 'apps/benefits-network');
  const migrations = path.join(app, 'backend/prisma/migrations');
  fs.mkdirSync(path.join(migrations, '20261006120000_old'), { recursive: true });
  fs.mkdirSync(path.join(app, 'frontend'));
  const oldSql = 'CREATE TABLE RewardEvent (id TEXT PRIMARY KEY, partnerId TEXT);\n';
  fs.writeFileSync(path.join(migrations, '20261006120000_old/migration.sql'), oldSql);
  fs.writeFileSync(path.join(migrations, 'migration_lock.toml'), 'provider = "sqlite"\n');
  fs.writeFileSync(path.join(app, 'backend/Dockerfile'), 'FROM fixture\n');
  fs.writeFileSync(path.join(app, 'frontend/Dockerfile'), 'FROM fixture\n');
  const previous = commit();
  fs.cpSync(app, runtime, { recursive: true });
  fs.writeFileSync(path.join(runtime, 'RELEASE_SHA'), previous + '\n');
  fs.writeFileSync(path.join(runtime, 'backend/.env'), secret);
  fs.mkdirSync(path.join(runtime, 'frontend/node_modules'));
  fs.writeFileSync(path.join(runtime, 'frontend/node_modules/host-only'), secret);
  fs.writeFileSync(path.join(runtime, 'obsolete-source'), 'must be deleted by sync');
  fs.mkdirSync(path.join(migrations, migration));
  fs.writeFileSync(path.join(migrations, migration, 'migration.sql'), variant === 'sql' ? sql + '-- drift\n' : sql);
  fs.appendFileSync(path.join(app, 'backend/Dockerfile'), 'USER node\n');
  if (variant === 'extra') { fs.mkdirSync(path.join(migrations, 'unexpected')); fs.writeFileSync(path.join(migrations, 'unexpected/migration.sql'), 'SELECT 1;'); }
  if (variant === 'old') fs.appendFileSync(path.join(migrations, '20261006120000_old/migration.sql'), '-- edited\n');
  const target = commit();
  // Only immutable release IDs change in this fixture; production hooks/SQL digest
  // and their fail-closed behavior run unchanged. Tooling has its own clean commit.
  const toolScript = source.replace('readonly TARGET_RELEASE=3842f8ae4237ede7eadfc66c2887e3410026145b', 'readonly TARGET_RELEASE=' + target)
    .replace('readonly PREVIOUS_RELEASE=5468f561f98c2250eb210ace1bb42dc442bd5fc8', 'readonly PREVIOUS_RELEASE=' + previous);
  fs.writeFileSync(path.join(tools, filename), toolScript);
  fs.copyFileSync(path.join(__dirname, 'benefits-backend-volume-ownership.sh'), path.join(tools, 'benefits-backend-volume-ownership.sh'));
  command('git', ['init', '-q', tools]);
  command('git', ['-C', tools, 'add', '.']);
  command('git', ['-C', tools, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '-qm', 'reviewed tools']);
  const db = path.join(volume, 'benefits.db');
  command('python3', ['-I', '-B', '-c', `import sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.executescript(sys.argv[2]); c.execute('INSERT INTO RewardEvent VALUES (?, ?)', ('${secret}', 'partner'))
c.execute('CREATE TABLE _prisma_migrations (id TEXT PRIMARY KEY, migration_name TEXT, finished_at TEXT, rolled_back_at TEXT, checksum TEXT)')
c.execute("INSERT INTO _prisma_migrations VALUES ('old', '20261006120000_old', 'finished', NULL, 'old-checksum')")
c.commit(); c.close()`, db, oldSql]);
  const sqlFile = path.join(root, 'migration.sql'); fs.writeFileSync(sqlFile, sql);
  const compose = path.join(root, 'compose.yml'), envFile = path.join(root, 'runtime.env');
  fs.writeFileSync(compose, 'services: {}\n'); fs.writeFileSync(envFile, 'SECRET=' + secret);
  const state = path.join(root, 'state.json'), log = path.join(root, 'calls.jsonl');
  fs.writeFileSync(state, JSON.stringify({ running: true, tags: {}, owners: {} })); fs.writeFileSync(log, '');
  const shimFile = path.join(root, 'shim.cjs'); fs.writeFileSync(shimFile, shim, { mode: 0o755 });
  for (const c of ['docker', 'id', 'flock', 'stat', 'chown', 'curl', 'df', 'sha256sum']) fs.symlinkSync(shimFile, path.join(bin, c));
  // Model bounded timeout forwarding without depending on GNU coreutils on macOS.
  fs.writeFileSync(path.join(bin, 'timeout'), '#!/usr/bin/env bash\nwhile [[ "$1" == --* ]]; do shift; done\nshift\nexec "$@"\n', { mode: 0o755 });
  const env = { ...process.env, LC_ALL: 'C', PATH: bin + path.delimiter + process.env.PATH, TMPDIR: dirs.tmp,
    MIGRATION_REPO: repo, MIGRATION_EXPECTED_SHA: target, MIGRATION_PREVIOUS_SHA: previous,
    MIGRATION_DB_FILE: db, MIGRATION_SOURCE_DIR: runtime, MIGRATION_BACKUP_ROOT: backups,
    MIGRATION_COMPOSE_FILE: compose, MIGRATION_ENV_FILE: envFile,
    MIGRATION_HEALTH_URL: 'https://example.invalid/api/health', MIGRATION_READY_URL: 'https://example.invalid/api/ready', MIGRATION_FRONTEND_URL: 'https://example.invalid/',
    BENEFITS_OWNERSHIP_TEST_MODE: '1', BENEFITS_VOLUME_PATH: volume, BENEFITS_BACKUP_DIR: path.join(root, 'ownership-backups'),
    TEST_STATE: state, TEST_LOG: log, TEST_SECRET: secret, TEST_SQL: sqlFile };
  return { ...dirs, db, target, state: () => JSON.parse(fs.readFileSync(state)), calls: () => fs.readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse), env,
    run(mode, extra = {}) {
      const r = spawnSync('bash', [path.join(tools, filename), mode], { env: { ...env, ...extra }, encoding: 'utf8', timeout: 180000 });
      assert.equal(r.error, undefined);
      assert.ok(!(r.stdout + r.stderr).includes(secret), 'raw tool/row/secret output leaked');
      return r;
    } };
}

const hash = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const isDocker = (c, action) => c[0] === 'docker' && c[1] === action;

test('plan validates hooks, exact migration set and volume without mutations', t => {
  const f = fixture(t), before = hash(f.db), release = fs.readFileSync(path.join(f.runtime, 'RELEASE_SHA'), 'utf8');
  const r = f.run('plan'); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /hook_checks=PASS/); assert.equal(hash(f.db), before);
  assert.equal(fs.readFileSync(path.join(f.runtime, 'RELEASE_SHA'), 'utf8'), release);
  assert.deepEqual(fs.readdirSync(f.backups), []); assert.deepEqual(fs.readdirSync(f.tmp), []);
  assert.ok(!f.calls().some(c => ['create', 'start', 'rm', 'build'].some(a => isDocker(c, a)) || ['stop', 'up', 'build', 'tag'].some(a => c.includes(a)) || c[0] === 'chown'));
});

test('rehearse migrates only a private SQLite backup, deletes it, and prints aggregate PASS', t => {
  const f = fixture(t), ready = path.join(f.volume, 'writer-ready');
  // Keep a real SQLite connection open: committed data exists only in the live
  // WAL. An unsafe raw copy would lose it or fail the before-invariants.
  const writer = spawn('python3', ['-I', '-B', '-c', `import pathlib,sqlite3,sys
c=sqlite3.connect(sys.argv[1]); c.execute('PRAGMA journal_mode=WAL')
c.execute("INSERT INTO RewardEvent VALUES ('wal-only', 'partner')"); c.commit()
pathlib.Path(sys.argv[2]).touch(); sys.stdin.read(); c.close()`, f.db, ready], { stdio: ['pipe', 'ignore', 'ignore'] });
  try {
  command('python3', ['-I', '-B', '-c', `import pathlib,sys,time
for _ in range(1000):
 if pathlib.Path(sys.argv[1]).exists(): break
 time.sleep(0.01)
else: raise RuntimeError('writer not ready')`, ready]);
  assert.ok(fs.statSync(f.db + '-wal').size > 0);
  const before = hash(f.db), wal = hash(f.db + '-wal'), release = fs.readFileSync(path.join(f.runtime, 'RELEASE_SHA'));
  const r = f.run('rehearse'); assert.equal(r.status, 0, r.stdout + r.stderr); assert.equal(r.stdout, 'rehearsal=PASS\n');
  assert.equal(hash(f.db), before); assert.equal(hash(f.db + '-wal'), wal); assert.deepEqual(fs.readFileSync(path.join(f.runtime, 'RELEASE_SHA')), release);
  assert.deepEqual(fs.readdirSync(f.tmp), []); assert.deepEqual(fs.readdirSync(f.backups), []); assert.equal(f.state().running, true);
  const create = f.calls().find(c => isDocker(c, 'create'));
  assert.ok(create.includes('none')); assert.ok(create.some(a => a.startsWith('type=bind,')));
  assert.ok(!f.calls().some(c => c.includes('stop') || c.includes('up') || (c[0] === 'chown' && c.at(-1) === f.volume)));
  } finally { writer.kill('SIGTERM'); }
});

test('successful apply builds before stop, owns volume before migration and verifies backup/invariants/online', t => {
  const f = fixture(t), before = hash(f.db), r = f.run('apply'); assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /status=PASS/); assert.equal(f.state().running, true); assert.equal(f.state().oneoff, undefined);
  const backup = path.join(f.backups, fs.readdirSync(f.backups).find(n => n.startsWith('benefits-migration-')));
  assert.equal(hash(path.join(backup, 'database.sqlite')), before);
  assert.equal(fs.statSync(backup).mode & 0o777, 0o700); assert.equal(fs.statSync(path.join(backup, 'runtime.env')).mode & 0o777, 0o600);
  command('sha256sum', ['--check', '--status', 'SHA256SUMS'], { cwd: backup, env: f.env });
  const after = JSON.parse(fs.readFileSync(path.join(backup, 'invariants-after.json')));
  assert.equal(after.tables.RewardEvent, 1); assert.equal(after.migration_records, 2); assert.equal(after.backfill_rows, 0);
  assert.equal(fs.existsSync(path.join(f.backups, '.benefits-migration.lock')), false); assert.deepEqual(fs.readdirSync(f.tmp), []);
  assert.equal(fs.readFileSync(path.join(f.runtime, 'RELEASE_SHA'), 'utf8').trim(), f.target);
  assert.equal(fs.readFileSync(path.join(f.runtime, 'backend/.env'), 'utf8'), secret);
  assert.equal(fs.readFileSync(path.join(f.runtime, 'frontend/node_modules/host-only'), 'utf8'), secret);
  assert.equal(fs.existsSync(path.join(f.runtime, 'obsolete-source')), false);
  const calls = f.calls(), build = calls.findIndex(c => c.includes('compose') && c.includes('build')), stop = calls.findIndex(c => c.includes('compose') && c.includes('stop'));
  assert.ok(build < stop && stop < calls.findIndex(c => c[0] === 'chown') && calls.findIndex(c => c[0] === 'chown') < calls.findIndex(c => isDocker(c, 'create')));
  assert.ok(calls.some(c => isDocker(c, 'exec') && c.at(-1) === '-u'));
  assert.ok(calls.some(c => c[0] === 'curl' && c.includes('POST') && c.at(-1).endsWith('/api/sessions/cutover-smoke/redeem')));
});

for (const [label, extra, phase] of [
  ['migration failure', { FAIL_MIGRATE: '1' }, 'migrate'],
  ['migration timeout', { FAIL_WAIT: '1' }, 'migrate'],
  ['changed application counts', { DROP_ROW: '1' }, 'invariants_after'],
  ['retired route regression', { BAD_SMOKE: '1' }, 'postcheck'],
  ['backend root regression', { BAD_UID: '1' }, 'postcheck'],
]) test(`apply fails closed: ${label}`, t => {
  const f = fixture(t), r = f.run('apply', extra); assert.notEqual(r.status, 0); assert.match(r.stderr, new RegExp('phase=' + phase));
  assert.equal(f.state().running, false); assert.ok(fs.existsSync(path.join(f.backups, '.benefits-migration.lock')));
  assert.equal(f.state().oneoff, undefined); assert.deepEqual(fs.readdirSync(f.tmp), []);
  if (phase !== 'postcheck') assert.ok(!f.calls().some(c => c.includes('up')));
});

for (const variant of ['extra', 'old', 'sql']) test(`refuses migration artifact drift: ${variant}`, t => {
  const f = fixture(t, variant), before = hash(f.db), r = f.run('plan');
  assert.notEqual(r.status, 0); assert.match(r.stderr, /phase=migration_hook_check/); assert.equal(hash(f.db), before);
  assert.deepEqual(fs.readdirSync(f.backups), []); assert.equal(f.state().running, true);
  assert.ok(!f.calls().some(c => c.includes('stop') || c.includes('build') || c.includes('create')));
});

test('rehearsal migration failure cleans copy and one-off, keeps services running, and prints only FAIL', t => {
  const f = fixture(t), before = hash(f.db), r = f.run('rehearse', { FAIL_MIGRATE: '1' });
  assert.notEqual(r.status, 0); assert.equal(r.stdout, 'rehearsal=FAIL\n'); assert.equal(r.stderr, '');
  assert.equal(hash(f.db), before); assert.equal(f.state().running, true); assert.deepEqual(fs.readdirSync(f.tmp), []);
});

test('refuses wrong frontend chain before backup or downtime', t => {
  const f = fixture(t), r = f.run('apply', { BAD_CHAIN: '1' });
  assert.notEqual(r.status, 0); assert.deepEqual(fs.readdirSync(f.backups), []); assert.equal(f.state().running, true);
});
