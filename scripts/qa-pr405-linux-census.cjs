'use strict';
// Temporary QA branch only. No third-party imports outside the qualified unit.
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const cp = require('node:child_process'), net = require('node:net'), assert = require('node:assert/strict');
const SOURCE = '02e6dda05d4ba80cfc314592de6d4d99cb199fe6', TREE = 'cbe588a9cf65527652e986967a31cdeac15a0485';
const BASE = 'c6c91a9fc548d2915985d6e3ba9c5d5846d9a4a2', MAIN = '82bc24d9451e7a446ae56234c9e0f1c03bf706e3';
const MAP = '97391d86d615f26691c37007bbcaf9e24e46d3f9e3ad76cdccb39d1bc169f1e1';
const PINS = { 'package.json': '416ee2981c02d2cbd593180f67318959efa8e35e55259bd7f3cee11c9588b7c6', 'package-lock.json': '5ca043d1dc147ce2e4fe4d55abe22f22855c83b90e18cb483bca6ce96c12fe1a', 'checker.cjs': '81fb214c8d25cc65d2cf762a384b0882eeb83b1221505f213701332c5ef20c33', 'baseline.json': '6586e2b4c51aa86ce14660021c0eecc5c5c1d6d34758ca2e74e1aef6befa610c' };
const VERSIONS = { 'markdownlint-cli': '0.50.0', markdownlint: '0.42.1', re2js: '2.9.1', minimatch: '11.0.1', 'js-yaml': '5.5.0', 'smol-toml': '1.9.1', argparse: '3.0.4' };
const CLI_SHA = 'fa97eeeb30201fb0417570701068858eef6e6c6b52475b953e28cf5b868eb529';
const RULES = ['MD013', 'MD033', 'MD041', 'MD024', 'MD036', 'MD040'];
const UNIT_NODE = '/tmp/ifr405-node', UNIT_INPUT = '/tmp/ifr405-input', UNIT_MODULES = '/tmp/ifr405-modules';
const UNIT_PROPERTIES = { DynamicUser: 'yes', MemoryMax: String(768 * 1024 ** 2), TasksMax: '32', CPUQuota: '200%', RuntimeMaxSec: '35s', PrivateNetwork: 'yes', PrivateTmp: 'yes', PrivateDevices: 'yes', PrivateMounts: 'yes', ProtectSystem: 'strict', ProtectHome: 'yes', ProtectProc: 'invisible', NoNewPrivileges: 'yes', CapabilityBoundingSet: '', AmbientCapabilities: '', RestrictNamespaces: 'yes', RestrictSUIDSGID: 'yes', RestrictAddressFamilies: 'AF_UNIX', InaccessiblePaths: '/run /var/run /home /root', KillMode: 'control-group', TimeoutStopSec: '2s' };
const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex'), sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const fail = reason => { throw new Error(reason); }, ensure = (value, reason) => { if (!value) fail(reason); };
const safeEnv = home => ({ PATH: '/usr/bin:/bin', HOME: home, LANG: 'C', LC_ALL: 'C', TZ: 'UTC', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0', GIT_NO_LAZY_FETCH: '1' });
let root, payload, acquire, evidence, node, token, begin, workDeadline, hardDeadline, hardTimer, watchTimer;
const records = new Map(), children = [], units = [], closers = new Map(); let stopping = false, stopReason = null, aborting;
function relative(name) {
  ensure(typeof name === 'string' && name && !/[\\:\x00-\x1f]/.test(name) && !name.startsWith('/') && name.split('/').every(p => p && p !== '.' && p !== '..'), 'PATH_CLOSURE'); return name;
}
function strictJson(text) {
  const result = JSON.parse(text), stack = [], tokens = text.match(/"(?:\\.|[^"\\])*"|[{}\[\]:,]|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null/g) || [];
  tokens.forEach((t, i) => { if (t === '{' || t === '[') stack.push(t === '{' ? new Set() : null); else if (t === '}' || t === ']') stack.pop(); else if (t.startsWith('"') && tokens[i + 1] === ':') { const k = JSON.parse(t), keys = stack.at(-1); ensure(keys && !keys.has(k), 'DUPLICATE_JSON_KEY'); keys.add(k); } }); return result;
}
function diagnostics(text, names, status) {
  const list = strictJson(text), allowed = new Set(names), keys = new Set(['fileName', 'lineNumber', 'ruleNames', 'ruleDescription', 'ruleInformation', 'errorDetail', 'errorContext', 'errorRange', 'fixInfo', 'severity']);
  ensure(Array.isArray(list) && [0, 1].includes(status) && status === (list.length ? 1 : 0), 'RESULT_SCHEMA_OR_EXIT');
  for (const row of list) {
    ensure(row && !Array.isArray(row) && typeof row === 'object' && Object.keys(row).every(k => keys.has(k)), 'DIAGNOSTIC_SCHEMA');
    ensure(allowed.has(relative(row.fileName)) && row.fileName.endsWith('.md') && Number.isSafeInteger(row.lineNumber) && row.lineNumber > 0, 'CLOSED_FILENAME_OR_LINE');
    ensure(Array.isArray(row.ruleNames) && /^MD\d{3}$/.test(row.ruleNames[0]) && row.ruleNames.every(x => typeof x === 'string' && x) && !RULES.includes(row.ruleNames[0]), 'RULE_SCHEMA');
    for (const k of ['errorDetail', 'errorContext', 'ruleDescription', 'ruleInformation']) ensure(row[k] == null || typeof row[k] === 'string', 'DIAGNOSTIC_TEXT');
    ensure(row.errorRange == null || (Array.isArray(row.errorRange) && row.errorRange.length === 2 && row.errorRange.every(x => Number.isSafeInteger(x) && x > 0)), 'DIAGNOSTIC_RANGE');
  } return list;
}
function frames(input, status, budget = 8 * 1024 ** 2) {
  const manifest = [...input].map(([name, bytes]) => { ensure(/^[A-Z][A-Z0-9_.-]*$/i.test(name), 'LOG_RECORD_NAME'); return { name, bytes: bytes.length, sha256: sha(bytes), total: Math.max(1, Math.ceil(bytes.length / 8192)) }; });
  const proofSetSha256 = sha(Buffer.from(JSON.stringify(manifest))), lines = [JSON.stringify({ schema: 'ifr405.qa.begin/v1', status, proofSetSha256, records: manifest })];
  for (const item of manifest) for (let seq = 0; seq < item.total; seq++) { const chunk = input.get(item.name).subarray(seq * 8192, (seq + 1) * 8192); lines.push(JSON.stringify({ schema: 'ifr405.qa.chunk/v1', name: item.name, seq, total: item.total, bytes: item.bytes, sha256: item.sha256, chunkSha256: sha(chunk), encoding: 'base64', data: chunk.toString('base64') })); }
  lines.push(JSON.stringify({ schema: 'ifr405.qa.end/v1', status, proofSetSha256, recordCount: manifest.length }));
  ensure(lines.every(line => Buffer.byteLength(line) + 1 <= 16384) && lines.reduce((sum, line) => sum + Buffer.byteLength(line) + 1, 0) <= budget, 'LOG_BUDGET_EXCEEDED'); return lines.join('\n') + '\n';
}
function put(name, bytes) { ensure(!records.has(name), 'DUPLICATE_RECORD'); bytes = Buffer.isBuffer(bytes) ? bytes : Buffer.from(JSON.stringify(bytes, null, 2) + '\n'); fs.writeFileSync(path.join(evidence, name), bytes, { flag: 'wx', mode: 0o600 }); records.set(name, bytes); return bytes; }
function command(file, args, timeout = 3000) { const left = (stopping ? hardDeadline : workDeadline) - Date.now(); ensure(left > 0, 'COMMAND_DEADLINE'); return cp.execFileSync(file, args, { env: safeEnv(path.join(root, 'home')), timeout: Math.min(timeout, left), maxBuffer: 32 * 1024 ** 2, stdio: ['ignore', 'pipe', 'pipe'] }); }
const git = (...args) => command('/usr/bin/git', ['--no-optional-locks', '-c', 'core.fsmonitor=false', ...args]);
function inventory(commit) {
  return git('ls-tree', '-r', '-z', '--full-tree', commit).toString('utf8').split('\0').filter(Boolean).map(line => { const m = /^(\d{6}) (\w+) ([0-9a-f]{40})\t(.+)$/.exec(line); ensure(m, 'GIT_SCHEMA'); return { mode: m[1], type: m[2], oid: m[3], path: relative(m[4]) }; });
}
function tree(directory, prefix = '') {
  return fs.readdirSync(directory).sort().flatMap(name => { const file = path.join(directory, name), nameInTree = prefix ? `${prefix}/${name}` : name, info = fs.lstatSync(file); ensure(info.isFile() || info.isDirectory(), 'SYMLINK_OR_SPECIAL_TREE_ENTRY'); return info.isDirectory() ? tree(file, nameInTree) : [[nameInTree, info.size, sha(fs.readFileSync(file))]]; });
}
function absent(file) { try { fs.lstatSync(file); return false; } catch (error) { if (error.code === 'ENOENT') return true; throw error; } }
function publicReadOnly(directory) { for (const name of fs.readdirSync(directory)) { const file = path.join(directory, name), info = fs.lstatSync(file); ensure(info.isFile() || info.isDirectory(), 'PUBLIC_TREE_SPECIAL_ENTRY'); if (info.isDirectory()) publicReadOnly(file); else fs.chmodSync(file, 0o444); } fs.chmodSync(directory, 0o555); }
function scratchBytes(directory) { return fs.readdirSync(directory).reduce((sum, name) => { const file = path.join(directory, name), info = fs.lstatSync(file); ensure(info.isFile() || info.isDirectory(), 'SCRATCH_LINK_OR_SPECIAL_ENTRY'); return sum + (info.isDirectory() ? scratchBytes(file) : info.size); }, 0); }
function snapshot() {
  ensure(git('rev-parse', `${SOURCE}^{tree}`).toString().trim() === TREE, 'SOURCE_TREE'); git('merge-base', '--is-ancestor', BASE, SOURCE);
  const md = rows => rows.filter(r => r.path.endsWith('.md')).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  const current = inventory(SOURCE), docs = md(current), old = md(inventory(BASE)), main = md(inventory(MAIN));
  const names = docs.map(r => r.path); ensure(names.length === 254 && new Set(names).size === 254, '254_CLOSED_CORPUS'); assert.deepEqual(names, old.map(r => r.path)); assert.deepEqual(old, main);
  ensure(docs.every(r => ['100644', '100755'].includes(r.mode) && r.type === 'blob'), 'MD_REGULAR_BLOBS'); assert.deepEqual(docs.filter((r, i) => r.oid !== old[i].oid).map(r => r.path), ['docs/architecture/MAP.md']);
  ensure(!current.some(r => path.posix.basename(r.path).startsWith('.markdownlint')), 'SOURCE_CONFIG_PRESENT'); fs.mkdirSync(path.join(payload, 'md'), { recursive: true });
  const files = docs.map(row => { const bytes = git('cat-file', 'blob', row.oid), file = path.join(payload, 'md', row.path); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o444 }); return { path: row.path, bytes: bytes.length, sha256: sha(bytes) }; });
  ensure(files.find(r => r.path === 'docs/architecture/MAP.md').sha256 === MAP, 'MAP_PIN');
  for (const [name, expected] of Object.entries(PINS)) { const sourcePath = name === 'checker.cjs' ? 'scripts/check-markdownlint-baseline.cjs' : name === 'baseline.json' ? 'audit/markdownlint-baseline.json' : name, commit = name.endsWith('.cjs') || name === 'baseline.json' ? BASE : SOURCE; const bytes = git('cat-file', 'blob', `${commit}:${sourcePath}`); ensure(sha(bytes) === expected, 'INPUT_PIN'); fs.writeFileSync(path.join(payload, name), bytes, { flag: 'wx', mode: 0o444 }); }
  fs.copyFileSync(__filename, path.join(payload, 'collector.cjs'), fs.constants.COPYFILE_EXCL); fs.chmodSync(path.join(payload, 'collector.cjs'), 0o444);
  const manifest = { sourceCommit: SOURCE, sourceTree: TREE, baseCommit: BASE, mainCoverageCommit: MAIN, sourceConfigMetadata: [], files, packagePins: PINS, collectorSha256: sha(fs.readFileSync(__filename)) }; fs.writeFileSync(path.join(payload, 'MANIFEST.json'), JSON.stringify(manifest), { flag: 'wx', mode: 0o444 });
  put('MANIFEST.json', manifest); return manifest;
}
function lockGraph() {
  const lock = strictJson(fs.readFileSync(path.join(payload, 'package-lock.json'), 'utf8')), rows = [];
  for (const [name, record] of Object.entries(lock.packages)) if (name) { ensure(relative(name).startsWith('node_modules/'), 'LOCK_PATH'); const url = new URL(record.resolved); ensure(url.protocol === 'https:' && url.hostname === 'registry.npmjs.org' && !url.username && !url.password && !url.hash && !url.search && (!url.port || url.port === '443') && !record.link && /^sha(512|256|1)-/.test(record.integrity), 'NONREGISTRY_OR_UNSIGNED_LOCK_ENTRY'); ensure(record.optional === undefined || typeof record.optional === 'boolean', 'LOCK_OPTIONAL_SCHEMA'); rows.push({ path: name, version: record.version, resolved: record.resolved, integrity: record.integrity, ...Object.fromEntries(['optional', 'os', 'cpu', 'libc'].filter(key => Object.hasOwn(record, key)).map(key => [key, record[key]])) }); }
  put('LOCK-SRI-GRAPH.json', rows); return rows;
}
function selectorMatches(value, list) {
  list = typeof list === 'string' ? [list] : list; ensure(Array.isArray(list) && list.every(entry => typeof entry === 'string' && /^!?[A-Za-z0-9_.-]+$/.test(entry)), 'PLATFORM_SELECTOR_SCHEMA'); if (list.length === 1 && list[0] === 'any') return true;
  let negated = 0, matched = false; for (const entry of list) { if (entry.startsWith('!')) { negated++; if (value === entry.slice(1)) return false; } else matched ||= value === entry; } return matched || negated === list.length;
}
function skipMissing(row, target) { const rejectedBy = ['os', 'cpu', 'libc'].filter(key => Object.hasOwn(row, key) && !selectorMatches(target[key], row[key])); ensure(row.optional === true && rejectedBy.length > 0, 'MISSING_APPLICABLE_OR_UNCONSTRAINED_PACKAGE'); return { ...row, target, rejectedBy }; }
function installed(graph, target) {
  const directory = path.join(acquire, 'node_modules'), rows = tree(directory), paths = rows.map(r => r[0]); assert.deepEqual(paths.filter(p => p === 'minimatch/package.json' || p.endsWith('/minimatch/package.json')), ['minimatch/package.json']);
  for (const [name, version] of Object.entries(VERSIONS)) { const item = strictJson(fs.readFileSync(path.join(directory, name, 'package.json'), 'utf8')); ensure(item.name === name && item.version === version, 'INSTALLED_PIN'); }
  ensure(sha(fs.readFileSync(path.join(directory, 'markdownlint-cli/markdownlint.js'))) === CLI_SHA, 'CLI_SRI_SOURCE_PIN');
  const skipped = []; for (const row of graph) { const dir = path.join(acquire, row.path); if (absent(dir)) { skipped.push(skipMissing(row, target)); continue; } const item = strictJson(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); ensure(item.version === row.version, 'SRI_GRAPH_INSTALLED_VERSION'); }
  put('OPTIONAL-PLATFORM-SKIPS.json', skipped);
  put('INSTALLED-MODULES.json', rows); return rows;
}
function proc(pid) { try { const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8'), fields = text.slice(text.lastIndexOf(')') + 2).split(' '); return { pid, pgid: Number(fields[2]), sid: Number(fields[3]), start: fields[19] }; } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
function groupAbsent(pgid) { try { process.kill(-pgid, 0); return false; } catch (error) { if (error.code === 'ESRCH') return true; throw error; } }
function members(group) { return fs.readdirSync('/proc').filter(n => /^\d+$/.test(n)).map(n => proc(Number(n))).filter(row => row && row.pgid === group.pgid); }
function stopGroup(record) {
  if (record.absent) return;
  if (groupAbsent(record.pgid)) { record.absent = true; return; }
  const rows = members(record); ensure(rows.length && rows.every(row => row.sid === record.sid) && !rows.some(row => row.pid === record.pid && row.start !== record.start), 'GROUP_OWNERSHIP_UNCERTAIN');
  command('/usr/bin/sudo', ['-n', '/bin/kill', '-KILL', '--', String(-record.pgid)], 1000);
}
function show(unit) {
  const fields = ['Id', 'Description', 'LoadState', 'ActiveState', 'SubState', 'InvocationID', 'MainPID', 'ControlGroup', 'BindReadOnlyPaths', ...Object.keys(UNIT_PROPERTIES).filter(k => !['CPUQuota', 'RuntimeMaxSec', 'TimeoutStopSec'].includes(k)), 'CPUQuotaPerSecUSec', 'RuntimeMaxUSec', 'TimeoutStopUSec'];
  let output, status = 0; try { output = command('/usr/bin/systemctl', ['show', unit, '--no-pager', ...fields.flatMap(k => ['--property', k])], 1000); } catch (error) { ensure(error.status === 1 && Buffer.isBuffer(error.stdout), 'SYSTEMCTL_SHOW_UNAVAILABLE'); output = error.stdout; status = 1; }
  const info = Object.fromEntries(output.toString('utf8').trim().split('\n').map(line => { const i = line.indexOf('='); ensure(i > 0, 'SYSTEMCTL_SHOW_SCHEMA'); return [line.slice(0, i), line.slice(i + 1)]; }));
  ensure(info.Id === unit && info.LoadState && (!status || info.LoadState === 'not-found'), 'SYSTEMCTL_SHOW_NOT_PROOF'); return info;
}
function properties(info, unit, ready, nodeSha) {
  ensure(info.Id === unit && info.ActiveState === 'active' && info.SubState === 'running' && Number(info.MainPID) === ready.pid && /^[0-9a-f]{32}$/.test(info.InvocationID), 'UNIT_EXISTENCE_OR_IDENTITY');
  ensure(ready.uid > 0 && ready.nodeSha256 === nodeSha && ready.node === 'v22.22.2' && ready.platform === 'linux', 'UNIT_NODE_OR_DYNAMIC_UID');
  for (const [key, value] of Object.entries(UNIT_PROPERTIES)) if (!['CPUQuota', 'RuntimeMaxSec', 'TimeoutStopSec'].includes(key)) {
    if (key === 'InaccessiblePaths') assert.deepEqual(info[key].split(' ').sort(), value.split(' ').sort()); else ensure(info[key] === value, 'UNIT_PROPERTY_' + key);
  }
  ensure(['2s', '2000000'].includes(info.CPUQuotaPerSecUSec) && ['35s', '35000000'].includes(info.RuntimeMaxUSec) && ['2s', '2000000'].includes(info.TimeoutStopUSec), 'CPU_OR_RUNTIME_PROPERTY');
  ensure(info.ControlGroup === `/system.slice/${unit}`, 'OWN_CGROUP_PATH'); return info.ControlGroup;
}
function kernelLimits(cgroup) {
  const base = '/sys/fs/cgroup' + cgroup, read = name => fs.readFileSync(path.join(base, name), 'utf8').trim(), cpu = read('cpu.max').split(' ').map(Number);
  ensure(read('memory.max') === String(768 * 1024 ** 2) && read('pids.max') === '32' && cpu.length === 2 && cpu[0] / cpu[1] === 2, 'CGROUP_KERNEL_LIMITS');
  return { memoryMax: read('memory.max'), pidsMax: read('pids.max'), cpuMax: read('cpu.max') };
}
function closeUnit(record) {
  if (record.closed) return Promise.resolve(); if (closers.has(record.name)) return closers.get(record.name);
  const closing = (async () => { const current = show(record.name);
    if (current.LoadState !== 'not-found') { ensure(current.Description === record.description && /^[0-9a-f]{32}$/.test(current.InvocationID) && (!record.invocation || current.InvocationID === record.invocation) && (!current.ControlGroup || current.ControlGroup === record.cgroup), 'UNIT_OWNERSHIP_UNCERTAIN'); record.invocation = current.InvocationID; command('/usr/bin/sudo', ['-n', '/usr/bin/systemctl', 'stop', record.name], 3000); }
    const until = Math.min(Date.now() + 2000, hardDeadline);
    do { const info = show(record.name); if (info.LoadState === 'not-found' && absent('/sys/fs/cgroup' + record.cgroup)) { record.closed = true; return; } await sleep(50); } while (Date.now() < until); fail('UNIT_OR_CGROUP_NOT_ABSENT');
  })(); closers.set(record.name, closing); return closing;
}
function abortOwned(reason) { stopping = true; stopReason ||= reason; if (!aborting) aborting = (async () => { try { await cleanupUnits(); } finally { for (const group of children) stopGroup(group); } })().catch(error => { stopReason += '; CLEANUP_UNCERTAIN_' + error.message; }); }
async function capture(label, file, args, milliseconds, outcap, options = {}) {
  ensure(!stopping && Date.now() < workDeadline, 'WORK_ABORTED');
  const result = { label, code: null, stdout: Buffer.alloc(0), stderr: Buffer.alloc(0) }, chunks = [[], []], counts = [0, 0];
  const child = cp.spawn(file, args, { cwd: options.cwd || root, env: options.env || safeEnv(path.join(root, 'home')), stdio: ['pipe', 'pipe', 'pipe'], detached: true });
  const witness = child.pid && proc(child.pid), group = witness && witness.pid === witness.pgid && witness.pid === witness.sid ? { ...witness, absent: false } : { pid: child.pid, pgid: child.pid, sid: null, start: null, absent: false }; children.push(group);
  let expired = false, error = group.sid ? null : new Error('WRAPPER_GROUP_BINDING'), readyBuffer = Buffer.alloc(0), accepted = false;
  const timer = setTimeout(() => { expired = true; abortOwned(label + '_DEADLINE'); }, Math.min(milliseconds, workDeadline - Date.now()));
  const append = (index, bytes) => { counts[index] += bytes.length; if (counts[0] + counts[1] > outcap) { error = new Error(label + '_OUTPUT_CAP'); abortOwned(error.message); return; } chunks[index].push(bytes); };
  child.stdout.on('data', bytes => {
    try { if (options.ready && !accepted) { readyBuffer = Buffer.concat([readyBuffer, bytes]); ensure(readyBuffer.length <= 2048, 'READY_FRAME_CAP'); const at = readyBuffer.indexOf(10); if (at < 0) return; const first = readyBuffer.subarray(0, at).toString('utf8'); ensure(first.startsWith('IFR405_READY '), 'TRUSTED_READY_REQUIRED'); ensure(!error && !stopping && Date.now() < workDeadline, 'WRAPPER_GROUP_OR_WORK_GATE'); options.ready(strictJson(first.slice(13))); accepted = true; append(0, readyBuffer.subarray(at + 1)); child.stdin.end('GO\n'); } else append(0, bytes); } catch (failure) { error = failure; abortOwned(error.message); child.stdin.destroy(); }
  });
  child.stderr.on('data', bytes => append(1, bytes));
  child.stdin.on('error', failure => { error = failure; abortOwned('OWNER_PIPE_FAILURE'); });
  const code = await new Promise(resolve => { child.on('error', failure => { error = failure; abortOwned('SPAWN_FAILURE'); }); child.on('close', resolve); if (error) abortOwned(error.message); }).finally(() => clearTimeout(timer));
  result.code = code; result.stdout = Buffer.concat(chunks[0]); result.stderr = Buffer.concat(chunks[1]);
  if (options.unit) await closeUnit(options.unit);
  if (!groupAbsent(group.pgid)) stopGroup(group); const until = Date.now() + 1000; while (!groupAbsent(group.pgid) && Date.now() < until) await sleep(20); group.absent = groupAbsent(group.pgid);
  put(label + '.stdout', result.stdout); put(label + '.stderr', result.stderr); put(label + '.json', { code, expired, complete: !error && !expired, bytes: counts, group, unit: options.unit || null, argv: [file, ...args], rawSha256: [sha(result.stdout), sha(result.stderr)] });
  ensure(group.absent && !expired && !error && (!options.ready || accepted), error ? error.message : label + '_INCOMPLETE'); return result;
}
async function cleanupUnits() { const errors = []; for (const unit of units) if (!unit.closed) { try { await closeUnit(unit); } catch (error) { errors.push(error.message); } } ensure(!errors.length, errors.join('; ')); }
async function unitRun(label, mode, nodeSha) {
  const name = `inferno-pr405-${token}-${label.toLowerCase()}.service`, unit = { name, description: `ifr405-owned-${token}`, invocation: null, cgroup: `/system.slice/${name}`, closed: false };
  ensure(show(name).LoadState === 'not-found', 'UNIT_NAME_ALREADY_EXISTS'); units.push(unit);
  const binds = [`${payload}:${UNIT_INPUT}:norbind`, `${path.join(acquire, 'node_modules')}:${UNIT_MODULES}:norbind`, `${node}:${UNIT_NODE}:norbind`];
  const args = ['-n', '/usr/bin/systemd-run', '--quiet', '--wait', '--pipe', '--collect', '--service-type=exec', '--unit=' + name, '--property=Description=' + unit.description, ...Object.entries(UNIT_PROPERTIES).map(([k, v]) => `--property=${k}=${v}`), '--property=BindReadOnlyPaths=' + binds.join(' '), '--', '/usr/bin/env', '-i', 'HOME=/tmp/ifr405-home', 'TMPDIR=/tmp', 'PATH=/usr/bin:/bin', 'LANG=C', 'LC_ALL=C', 'TZ=UTC', UNIT_NODE, '--max-old-space-size=512', '--no-addons', UNIT_INPUT + '/collector.cjs', mode];
  return capture(label, '/usr/bin/sudo', args, mode === 'inside-census' ? 35000 : 12000, mode === 'inside-census' ? 16 * 1024 ** 2 : 1024 ** 2, { unit, ready(ready) { const info = show(name); ensure(info.Description === unit.description && info.BindReadOnlyPaths === binds.join(' '), 'EXACT_UNIT_BINDS_OR_OWNER'); unit.invocation = info.InvocationID; properties(info, name, ready, nodeSha); put(label + '-UNIT.json', { properties: info, kernel: kernelLimits(unit.cgroup), binds, nodeSha256: nodeSha }); } });
}
async function inside(mode) {
  ensure(process.platform === 'linux' && process.version === 'v22.22.2' && process.getuid() > 0, 'INSIDE_PLATFORM_UID');
  fs.mkdirSync('/tmp/ifr405-home', { mode: 0o700 });
  process.stdout.write('IFR405_READY ' + JSON.stringify({ pid: process.pid, uid: process.getuid(), node: process.version, platform: process.platform, nodeSha256: sha(fs.readFileSync(process.execPath)) }) + '\n');
  await new Promise((resolve, reject) => { let data = ''; const timer = setTimeout(() => reject(new Error('NO_OWNER_GATE')), 5000); process.stdin.setEncoding('utf8'); process.stdin.on('data', part => { data += part; if (data === 'GO\n') { clearTimeout(timer); resolve(); } else if (data.length > 3) reject(new Error('BAD_OWNER_GATE')); }); process.stdin.on('end', () => { if (data !== 'GO\n') reject(new Error('OWNER_GATE_EOF')); }); });
  if (mode === 'inside-probe') {
    let writeDenied = false; try { fs.writeFileSync('/usr/ifr405-denied-' + process.pid, 'forbidden', { flag: 'wx' }); } catch (error) { writeDenied = ['EROFS', 'EPERM', 'EACCES'].includes(error.code); }
    const tcpDenied = await new Promise(resolve => { const socket = net.connect({ host: '1.1.1.1', port: 443 }); socket.setTimeout(1000, () => { socket.destroy(); resolve(false); }); socket.on('connect', () => { socket.destroy(); resolve(false); }); socket.on('error', error => resolve(['EAFNOSUPPORT', 'EPERM'].includes(error.code))); });
    process.stdout.write(JSON.stringify({ tcpDenied, writeDenied }) + '\n'); ensure(tcpDenied && writeDenied, 'OS_REFUSAL_FAILED'); return 0;
  }
  const manifest = strictJson(fs.readFileSync(UNIT_INPUT + '/MANIFEST.json', 'utf8')), names = manifest.files.map(row => row.path);
  const args = mode === 'inside-version' ? ['--version'] : ['--json', '--disable', ...RULES, '--', ...names]; ensure(['inside-version', 'inside-census'].includes(mode), 'INSIDE_MODE');
  const result = cp.spawnSync(UNIT_NODE, ['--max-old-space-size=512', '--no-addons', UNIT_MODULES + '/markdownlint-cli/markdownlint.js', ...args], { cwd: UNIT_INPUT + '/md', env: { HOME: '/tmp/ifr405-home', TMPDIR: '/tmp', PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C', TZ: 'UTC' }, timeout: mode === 'inside-version' ? 5000 : 25000, maxBuffer: 16 * 1024 ** 2, killSignal: 'SIGKILL' });
  ensure(!result.error && result.signal === null && [0, 1].includes(result.status), 'CLI_FAILED_OR_TIMED_OUT'); process.stdout.write(result.stdout); process.stderr.write(result.stderr); return result.status;
}
function normalize(manifest, raw, version) {
  const started = Date.now();
  ensure(version.code === 0 && version.stdout.equals(Buffer.from('0.50.0\n')) && !version.stderr.length, 'ACTUAL_VERSION');
  ensure(Boolean(raw.stdout.length) !== Boolean(raw.stderr.length), 'SINGLE_JSON_CHANNEL'); const text = (raw.stdout.length ? raw.stdout : raw.stderr).toString('utf8'), names = manifest.files.map(row => row.path), list = diagnostics(text, names, raw.code);
  const sources = new Map(manifest.files.map(row => { const bytes = fs.readFileSync(path.join(payload, 'md', row.path)); ensure(sha(bytes) === row.sha256 && bytes.length === row.bytes, 'SOURCE_CHANGED'); return [row.path, bytes.toString('utf8')]; }));
  for (const item of list) ensure(item.lineNumber <= sources.get(item.fileName).split(/\r?\n/).length, 'LINE_OUTSIDE_SOURCE');
  const wrapper = path.join(payload, 'checker.cjs'), baselineBytes = fs.readFileSync(path.join(payload, 'baseline.json')); ensure(sha(fs.readFileSync(wrapper)) === PINS['checker.cjs'] && sha(baselineBytes) === PINS['baseline.json'], 'PROTECTED_ALGORITHM_HASH');
  const api = require(wrapper), old = strictJson(baselineBytes.toString('utf8')); assert.deepEqual(api.parseMarkdownlintResult({ status: raw.code, stdout: text, stderr: '' }), list);
  ensure(old.schemaVersion === 2 && old.tool === 'markdownlint-cli@0.49.1' && old.filesScanned === 254 && old.baselineIssues === 3601 && old.fingerprints.length === 2232, 'OLD_BASELINE'); assert.deepEqual(old.disabledRules, RULES);
  const actual = { ...api.createBaseline(names, list, name => sources.get(relative(name))), tool: 'markdownlint-cli@0.50.0' }, changes = api.compareBaseline(old.fingerprints, actual.fingerprints);
  const same = changes.length === 0 && actual.baselineIssues === 3601 && actual.fingerprints.length === 2232;
  ensure(Date.now() - started <= 15000 && Date.now() < workDeadline, 'NORMALIZATION_15S_OR_WORK_DEADLINE'); put('NORMALIZED.json', actual); put('COMPARISON.json', { status: same ? 'MATCH_NOT_MERGE' : 'DELTA_HOLD', changes, actualIssues: actual.baselineIssues, actualFingerprintRows: actual.fingerprints.length, filesScanned: 254, baselineSha256: PINS['baseline.json'], rawSha256: [sha(raw.stdout), sha(raw.stderr)], versionSha256: sha(version.stdout), oldProofRelabelled: false }); return same;
}
function removeOwned() {
  for (const unit of units) unit.closed = show(unit.name).LoadState === 'not-found' && absent('/sys/fs/cgroup' + unit.cgroup);
  for (const group of children) group.absent = groupAbsent(group.pgid);
  ensure(units.every(u => u.closed) && children.every(g => g.absent), 'CLEANUP_NOT_PROVEN');
  ensure(root === path.join(fs.realpathSync(process.env.RUNNER_TEMP), `ifr405-linux-${process.env.GITHUB_RUN_ID}-1`) && !fs.lstatSync(root).isSymbolicLink() && fs.readFileSync(path.join(root, 'OWNED'), 'utf8') === token, 'DELETE_SCOPE_GUARD');
  const remove = file => { const info = fs.lstatSync(file); if (info.isSymbolicLink() || !info.isDirectory()) fs.unlinkSync(file); else { fs.chmodSync(file, 0o700); for (const name of fs.readdirSync(file)) remove(path.join(file, name)); fs.rmdirSync(file); } }; remove(root);
}
async function controller() {
  ensure(process.platform === 'linux' && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_OS === 'Linux' && process.env.GITHUB_REPOSITORY === 'NeaBouli/inferno' && process.env.QA_PUBLIC === 'true', 'CI_PUBLIC_LINUX_ONLY');
  ensure(process.env.GITHUB_EVENT_NAME === 'pull_request' && process.env.GITHUB_HEAD_REF === 'agent/codex/pr405-linux-census-qa-20261112' && process.env.GITHUB_RUN_ATTEMPT === '1' && /^\d+$/.test(process.env.GITHUB_RUN_ID) && /^[0-9a-f]{40}$/.test(process.env.QA_HEAD), 'ONE_USE_QA_PR_ONLY');
  const temp = fs.realpathSync(process.env.RUNNER_TEMP); ensure(temp.startsWith('/home/runner/work/') && path.basename(temp) === '_temp', 'RUNNER_TEMP_SCOPE');
  root = path.join(temp, `ifr405-linux-${process.env.GITHUB_RUN_ID}-1`); ensure(absent(root), 'EXISTING_RUN_REFUSED'); fs.mkdirSync(root, { mode: 0o700 }); token = crypto.randomBytes(12).toString('hex'); fs.writeFileSync(path.join(root, 'OWNED'), token, { flag: 'wx', mode: 0o600 });
  payload = path.join(root, 'public-input'); acquire = path.join(root, 'acquire'); evidence = path.join(root, 'evidence'); for (const dir of [payload, acquire, evidence, path.join(root, 'home'), path.join(root, 'tmp'), path.join(acquire, 'node_modules')]) fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  begin = Date.now(); workDeadline = begin + 170000; hardDeadline = begin + 180000; let result = { status: 'HOLD', sourceCommit: SOURCE, sourceTree: TREE, liveAcceptance: false }, tool;
  hardTimer = setTimeout(() => { process.stdout.write(frames(new Map([['OUTER-LIMIT.json', Buffer.from(JSON.stringify({ status: 'HOLD', uncertainCleanup: true, units, children, scratchRetained: true }))]]), 'HOLD'), () => process.exit(124)); }, 180000);
  watchTimer = setInterval(() => { try { ensure(Date.now() < workDeadline, 'WORK_170S'); const bytes = scratchBytes(root), space = fs.statfsSync(root); ensure(bytes <= 1024 ** 3 && Number(space.bavail) * Number(space.bsize) >= 4 * 1024 ** 3, 'DISK_BOUND'); } catch (error) { abortOwned(error.message); } }, 500);
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => abortOwned(signal));
  try {
    node = fs.realpathSync(process.execPath); ensure(node.startsWith('/opt/hostedtoolcache/node/22.22.2/') && node.endsWith('/bin/node') && process.version === 'v22.22.2' && process.arch === 'x64', 'LINUX_NODE_TOOLCACHE_PIN');
    const npm = path.resolve(node, '../../lib/node_modules/npm'), npmBytes = fs.readFileSync(path.join(npm, 'package.json')), npmVersion = strictJson(npmBytes.toString('utf8')).version, nodeSha256 = sha(fs.readFileSync(node));
    ensure('excludeEnv' in process.report, 'NODE_REPORT_ENV_EXCLUSION'); process.report.excludeEnv = true; const glibcVersionRuntime = process.report.getReport().header.glibcVersionRuntime; ensure(typeof glibcVersionRuntime === 'string' && /^\d+\.\d+(?:\.\d+)*$/.test(glibcVersionRuntime), 'ACTUAL_GLIBC_REQUIRED');
    tool = { platform: process.platform, arch: process.arch, node: process.version, nodeSha256, glibcVersionRuntime, bundledNpmVersion: npmVersion, bundledNpmMetadataSha256: sha(npmBytes), expectedNpmVersion: '10.9.7', expectedLinuxNodeSha256: process.env.EXPECTED_LINUX_NODE_SHA256, macBinaryEqualityClaimed: false }; put('TOOL-ADMISSION.json', tool);
    ensure(npmVersion === '10.9.7' && /^[0-9a-f]{64}$/.test(tool.expectedLinuxNodeSha256) && nodeSha256 === tool.expectedLinuxNodeSha256, 'TOOL_ADMISSION_DELTA_BEFORE_ACQUISITION');
    ensure(git('rev-parse', 'HEAD').toString().trim() === process.env.QA_HEAD, 'QA_EXACT_HEAD'); git('merge-base', '--is-ancestor', SOURCE, 'HEAD'); assert.deepEqual(git('diff', '--name-only', SOURCE, 'HEAD').toString().trim().split('\n'), ['.github/workflows/pr405-linux-census-qa.yml', 'scripts/qa-pr405-linux-census.cjs']); git('diff', '--exit-code', 'HEAD'); const manifest = snapshot(), graph = lockGraph(); publicReadOnly(payload); publicReadOnly(path.join(acquire, 'node_modules')); const sourceBefore = tree(payload);
    const proof = await unitRun('PROBE', 'inside-probe', nodeSha256); ensure(proof.code === 0 && strictJson(proof.stdout.toString('utf8')).tcpDenied === true && strictJson(proof.stdout.toString('utf8')).writeDenied === true, 'TRUSTED_OS_CONTROLS');
    const emptyModules = path.join(acquire, 'node_modules'); ensure(units.at(-1).closed && fs.lstatSync(emptyModules).isDirectory() && fs.readdirSync(emptyModules).length === 0, 'POST_PROBE_OWNED_EMPTY_MODULES'); fs.chmodSync(emptyModules, 0o700);
    for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(payload, name), path.join(acquire, name), fs.constants.COPYFILE_EXCL);
    for (const name of ['.npmrc', 'USER.npmrc', 'GLOBAL.npmrc']) fs.writeFileSync(path.join(acquire, name), '', { flag: 'wx', mode: 0o600 });
    const args = ['--max-old-space-size=512', '--no-addons', path.join(npm, 'bin/npm-cli.js'), 'ci', '--ignore-scripts', '--no-bin-links', '--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=10000', '--strict-ssl=true', '--registry=https://registry.npmjs.org', '--update-notifier=false', '--logs-max=0', '--loglevel=error', '--userconfig=' + path.join(acquire, 'USER.npmrc'), '--globalconfig=' + path.join(acquire, 'GLOBAL.npmrc'), '--cache=' + path.join(acquire, 'cache')];
    const install = await capture('ACQUISITION', node, args, 90000, 1024 ** 2, { cwd: acquire, env: { ...safeEnv(path.join(root, 'home')), TMPDIR: path.join(root, 'tmp'), PATH: path.dirname(node) + ':/usr/bin:/bin', NO_PROXY: '', no_proxy: '' } }); ensure(install.code === 0, 'ONE_ACQUISITION_FAILED');
    for (const name of ['package.json', 'package-lock.json']) ensure(sha(fs.readFileSync(path.join(acquire, name))) === PINS[name], 'ACQUISITION_PAIR_MUTATED');
    const modules = installed(graph, { os: 'linux', cpu: 'x64', libc: 'glibc' }); publicReadOnly(path.join(acquire, 'node_modules')); const version = await unitRun('VERSION', 'inside-version', nodeSha256); ensure(version.code === 0 && version.stdout.equals(Buffer.from('0.50.0\n')) && !version.stderr.length, 'ACTUAL_VERSION_BEFORE_CENSUS'); const raw = await unitRun('CENSUS', 'inside-census', nodeSha256);
    assert.deepEqual(tree(payload), sourceBefore); assert.deepEqual(tree(path.join(acquire, 'node_modules')), modules); ensure(sha(fs.readFileSync(node)) === nodeSha256, 'LINUX_NODE_MUTATED');
    const same = normalize(manifest, raw, version); result.status = same ? 'MATCH_NOT_MERGE' : 'DELTA_HOLD';
    put('PROVENANCE.json', { qaHead: process.env.QA_HEAD, collectorSha256: sha(fs.readFileSync(__filename)), sourceCommit: SOURCE, sourceTree: TREE, baseCommit: BASE, mapSha256: MAP, manifestSha256: sha(Buffer.from(JSON.stringify(manifest))), tool, cliSourceSha256: CLI_SHA, versions: VERSIONS, sourceAndModuleClosureUnchanged: true, rawSha256: [sha(raw.stdout), sha(raw.stderr)], units, groups: children, baselineWritten: false, cloudArtifactOrCacheCreated: false });
  } catch (error) { result.reason = stopReason || error.message; }
  finally {
    clearInterval(watchTimer);
    stopping = stopping || Date.now() >= workDeadline;
    try { if (aborting) await aborting; await cleanupUnits(); for (const group of children) { if (!groupAbsent(group.pgid)) stopGroup(group); const until = Math.min(Date.now() + 1000, hardDeadline); while (!groupAbsent(group.pgid) && Date.now() < until) await sleep(20); group.absent = groupAbsent(group.pgid); } ensure(children.every(g => g.absent), 'OWN_GROUP_NOT_ABSENT'); } catch (error) { result.status = 'HOLD'; result.uncertainCleanup = true; result.cleanupReason = error.message; }
    if (stopping) { result.status = 'HOLD'; result.reason = stopReason; }
    result.elapsedMs = Date.now() - begin; result.units = units; result.groups = children; put('RESULT.json', { ...result, final: false, ownedRemovalPending: true });
    try { if (!result.uncertainCleanup) { removeOwned(); result.scratchRemoved = true; } } catch (error) { result.status = 'HOLD'; result.uncertainCleanup = true; result.cleanupReason = error.message; }
    result.elapsedMs = Date.now() - begin; records.set('FINAL-RESULT.json', Buffer.from(JSON.stringify({ ...result, final: true }, null, 2) + '\n'));
    let output; try { output = frames(records, result.status); } catch { const omitted = [...records].map(([name, bytes]) => ({ name, bytes: bytes.length, sha256: sha(bytes) })); result.status = 'HOLD_LOG_BUDGET'; output = frames(new Map([['LOG-BUDGET-HOLD.json', Buffer.from(JSON.stringify({ ...result, notEmittedDueToBudget: omitted, truncatedSuccessClaim: false }))]]), result.status); }
    clearTimeout(hardTimer); process.stdout.write(output); process.exitCode = result.status === 'MATCH_NOT_MERGE' ? 0 : 2;
  }
}
function selfTest() {
  let count = 0; const ok = fn => { fn(); count++; }, bad = fn => ok(() => assert.throws(fn));
  ok(() => relative('docs/space name.md')); for (const value of ['../a.md', '/a.md', 'docs//a.md', 'docs\\a.md', 'x\0.md']) bad(() => relative(value));
  const row = { fileName: 'a.md', lineNumber: 1, ruleNames: ['MD018'] }; ok(() => assert.equal(diagnostics(JSON.stringify([row]), ['a.md'], 1).length, 1));
  for (const value of ['{}', '[null]', '[{"a":1,"a":2}]', '[] trailing']) bad(() => diagnostics(value, ['a.md'], 1));
  for (const change of [{ fileName: '../a.md' }, { fileName: 'b.md' }, { lineNumber: 0 }, { ruleNames: ['MD013'] }, { extra: true }]) bad(() => diagnostics(JSON.stringify([{ ...row, ...change }]), ['a.md'], 1));
  const values = new Map([['CENSUS.stdout', Buffer.from('public diagnostic')], ['CENSUS.stderr', Buffer.alloc(0)]]), output = frames(values, 'PURE_ONLY');
  ok(() => { const lines = output.trim().split('\n').map(JSON.parse), chunks = lines.filter(x => x.schema === 'ifr405.qa.chunk/v1'); for (const [name, bytes] of values) { const encoded = chunks.filter(x => x.name === name).sort((a, b) => a.seq - b.seq); assert.deepEqual(Buffer.concat(encoded.map(x => Buffer.from(x.data, 'base64'))), bytes); assert.equal(encoded[0].sha256, sha(bytes)); } });
  bad(() => frames(values, 'PURE_ONLY', 10)); bad(() => frames(new Map([['../escape', Buffer.alloc(0)]]), 'PURE_ONLY'));
  ok(() => { const data = crypto.createHash('sha256').update('inert').digest(), bytes = Buffer.concat(Array.from({ length: 600 }, () => data)); const lines = frames(new Map([['RAW.stdout', bytes]]), 'PURE_ONLY').trim().split('\n'); ensure(lines.every(line => Buffer.byteLength(line) + 1 <= 16384), 'CHUNK_CAP'); const chunks = lines.map(JSON.parse).filter(row => row.schema === 'ifr405.qa.chunk/v1'); assert.deepEqual(chunks.map(row => row.seq), [0, 1, 2]); assert.deepEqual(Buffer.concat(chunks.map(row => Buffer.from(row.data, 'base64'))), bytes); assert.ok(chunks.every(row => sha(Buffer.from(row.data, 'base64')) === row.chunkSha256)); });
  bad(() => frames(new Map([['RAW.stdout', Buffer.alloc(6 * 1024 ** 2)]]), 'PURE_ONLY'));
  const name = 'inferno-pr405-pure-probe.service', ready = { pid: 42, uid: 61001, node: 'v22.22.2', platform: 'linux', nodeSha256: 'a'.repeat(64) }, info = { ...UNIT_PROPERTIES, Id: name, MainPID: '42', InvocationID: 'b'.repeat(32), ActiveState: 'active', SubState: 'running', ControlGroup: '/system.slice/' + name, CPUQuotaPerSecUSec: '2s', RuntimeMaxUSec: '35s', TimeoutStopUSec: '2s' };
  ok(() => assert.equal(properties(info, name, ready, ready.nodeSha256), info.ControlGroup));
  for (const change of [{ PrivateNetwork: 'no' }, { ProtectHome: 'no' }, { MemoryMax: 'max' }, { TasksMax: 'max' }, { CPUQuotaPerSecUSec: 'infinity' }, { RestrictAddressFamilies: 'AF_INET AF_UNIX' }, { CapabilityBoundingSet: 'cap_net_admin' }, { KillMode: 'process' }, { ControlGroup: '/system.slice/foreign.service' }, { MainPID: '43' }, { InvocationID: '' }]) bad(() => properties({ ...info, ...change }, name, ready, ready.nodeSha256));
  for (const change of [{ uid: 0 }, { platform: 'darwin' }, { node: 'v22.22.1' }, { nodeSha256: 'c'.repeat(64) }]) bad(() => properties(info, name, { ...ready, ...change }, ready.nodeSha256));
  const target = { os: 'linux', cpu: 'x64', libc: 'glibc' };
  for (const [list, value, expected] of [['linux', 'linux', true], [['!darwin'], 'linux', true], [['!linux'], 'linux', false], [['linux', '!linux'], 'linux', false], [['linux', '!darwin'], 'linux', true], [['any'], 'linux', true], [['any', '!darwin'], 'linux', false], [[], 'linux', true], [['musl'], 'glibc', false], [['arm64'], 'x64', false]]) ok(() => assert.equal(selectorMatches(value, list), expected));
  for (const row of [{ optional: true, os: ['darwin'] }, { optional: true, cpu: ['!x64'] }, { optional: true, libc: ['musl'] }]) ok(() => assert.ok(skipMissing(row, target).rejectedBy.length));
  for (const row of [{ optional: true }, { optional: true, os: ['linux'], cpu: ['x64'] }, { optional: false, os: ['darwin'] }, { os: ['darwin'] }, { optional: true, os: ['!darwin'] }, { optional: true, os: [123] }]) bad(() => skipMissing(row, target));
  console.log(JSON.stringify({ status: 'PASS_CORE_PURE_CONTROLS', count, systemdOrSudoInvoked: false, packageOrAppImported: false, realCensus: false }));
}
if (process.argv[2] === '--self-test' && process.argv.length === 3) selfTest();
else if (['inside-probe', 'inside-version', 'inside-census'].includes(process.argv[2]) && process.argv.length === 3) inside(process.argv[2]).then(code => { process.exitCode = code; }).catch(error => { process.stderr.write(JSON.stringify({ status: 'HOLD_INSIDE', reason: error.message }) + '\n'); process.exitCode = 2; });
else if (process.argv.length === 2) controller().catch(error => { process.stdout.write(frames(new Map([['EARLY-HOLD.json', Buffer.from(JSON.stringify({ status: 'HOLD', reason: error.message, realCensus: false }))]]), 'HOLD')); process.exitCode = 2; });
else { process.stderr.write('Fixed QA collector: unsupported invocation\n'); process.exitCode = 2; }
