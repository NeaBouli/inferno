'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const { types: { isProxy } } = require('node:util');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, 'qa-web3-audience-visual.cjs'), 'utf8');
const start = source.indexOf('function startupDiagnostics(error) {\n');
const end = source.indexOf("\nlet phase = 'ENTRY'", start);
assert.ok(start >= 0 && end > start, 'pure helper boundaries must exist');
const helperSource = source.slice(start, end);
// Compile the runner only. Evaluate just the trusted pure helper, never its entry point.
new vm.Script(source, { filename: 'qa-web3-audience-visual.cjs' });
// Only isProxy crosses into this trusted unit VM; no require or runner imports.
// Fixed helper mutations below are trusted test source, not hostile code isolation.
const loadHelper = text => new vm.Script(text + '\nstartupDiagnostics;').runInNewContext(
  Object.assign(Object.create(null), { isProxy }), { timeout: 1000, contextCodeGeneration: { strings: false, wasm: false } }
);
const classify = loadHelper(helperSource);
const details = [
  ['NO_USABLE_SANDBOX', 'No usable sandbox!', ['NO_USABLE_SANDBOX']],
  ['NEW_NAMESPACE_FAILED', 'Failed to move to new namespace', ['NEW_NAMESPACE_FAILED']],
  ['SUID_SANDBOX_MESSAGE', 'SUID sandbox', ['SUID_SANDBOX_MESSAGE']],
  ['SUID_HELPER_MISCONFIGURED', 'The SUID sandbox helper binary was found, but is not configured correctly.', ['SUID_SANDBOX_MESSAGE', 'SUID_HELPER_MISCONFIGURED']],
  ['PID_NAMESPACES_SUPPORTED', 'PID namespaces supported', ['PID_NAMESPACES_SUPPORTED']],
  ['NETWORK_NAMESPACES_SUPPORTED', 'Network namespace supported', ['NETWORK_NAMESPACES_SUPPORTED']],
  ['OPERATION_NOT_PERMITTED', 'Operation not permitted', ['OPERATION_NOT_PERMITTED']],
  ['PERMISSION_DENIED', 'Permission denied', ['PERMISSION_DENIED']],
  ['READ_ONLY_FILESYSTEM', 'Read-only file system', ['READ_ONLY_FILESYSTEM']],
  ['CLONE_FAILED', 'clone failed', ['CLONE_FAILED']]
];
const detailCodes = details.map(([code]) => code);
const signals = [
  ['SANDBOX_MESSAGE', ['No usable sandbox', 'Failed to move to new namespace', 'SUID sandbox']],
  ['EXECUTABLE_MESSAGE', ["Executable doesn't exist", 'Executable does not exist', 'executable not found', 'executable is not found', 'executable was not found']],
  ['SHARED_LIBRARY_MESSAGE', ['error while loading shared libraries', 'cannot open shared object file']],
  ['MODULE_RESOLUTION_MESSAGE', ['Cannot find module', 'Cannot find package', 'ERR_MODULE_NOT_FOUND']],
  ['PROTOCOL_MESSAGE', ['Protocol error', 'Target closed', 'Session closed', 'Connection closed']],
  ['TIMEOUT_MESSAGE', ['Timeout', 'TimeoutError', 'timed out']]
];
const unknown = { startupSignal: 'UNKNOWN', startupDetails: [] };
function closedResult(result) {
  assert.deepEqual(Reflect.ownKeys(result).sort(), ['startupDetails', 'startupSignal']);
  assert.equal(typeof result.startupSignal, 'string');
  assert.ok(['UNKNOWN', ...signals.map(([code]) => code)].includes(result.startupSignal));
  assert.ok(Array.isArray(result.startupDetails) && result.startupDetails.length <= 10);
  assert.ok(result.startupDetails.every(code => typeof code === 'string' && detailCodes.includes(code)));
  assert.deepEqual(Array.from(result.startupDetails), detailCodes.filter(code => result.startupDetails.includes(code)));
  return { startupSignal: result.startupSignal, startupDetails: Array.from(result.startupDetails) };
}
function assertDetailFixtures(helper) {
  for (const [code, message, expected] of details) {
    for (const text of [message, message.toLowerCase(), message.toUpperCase()]) {
      assert.deepEqual(closedResult(helper({ message: text })).startupDetails, expected, code);
    }
  }
  const combined = details.toReversed().map(([, text]) => text).join('\n');
  assert.deepEqual(closedResult(helper({ message: combined + '\n' + combined })), {
    startupSignal: 'SANDBOX_MESSAGE', startupDetails: detailCodes
  });
}
function assertAccessorFixtures(helper) {
  for (const behavior of ['return', 'throw', 'side-effect']) {
    let reads = 0;
    const effects = [];
    const error = Object.defineProperty({}, 'message', { get() {
      reads++;
      if (behavior === 'throw') throw new Error('RAW_SENTINEL');
      if (behavior === 'side-effect') effects.push('RAW_SENTINEL');
      return 'Permission denied';
    } });
    assert.deepEqual(closedResult(helper(error)), unknown, behavior);
    assert.equal(reads, 0, behavior + ' getter must never run');
    assert.deepEqual(effects, [], behavior + ' must have no side effects');
  }
  let writes = 0;
  assert.deepEqual(closedResult(helper(Object.defineProperty({}, 'message', { set() { writes++; } }))), unknown);
  assert.equal(writes, 0);
}
function assertProxyFixtures(helper) {
  for (const throwing of [false, true]) {
    const calls = { get: 0, getOwnPropertyDescriptor: 0, has: 0, ownKeys: 0, getPrototypeOf: 0 };
    const zero = { ...calls };
    const handler = Object.fromEntries(Object.keys(calls).map(trap => [trap, (...args) => {
      calls[trap]++;
      if (throwing) throw new Error('RAW_SENTINEL');
      return Reflect[trap](...args);
    }]));
    const revocable = Proxy.revocable({ message: 'No usable sandbox; Permission denied' }, handler);
    for (const error of [revocable.proxy, new Proxy(revocable.proxy, handler)]) {
      assert.deepEqual(closedResult(helper(error)), unknown);
      assert.deepEqual(calls, zero, 'live proxy traps must never run');
    }
    revocable.revoke();
    assert.deepEqual(closedResult(helper(revocable.proxy)), unknown);
    assert.deepEqual(calls, zero, 'revoked proxy traps must never run');
  }
}

test('all ten observations: individual, case-insensitive, combined, fixed order, deduplicated, max ten', () => {
  assertDetailFixtures(classify);
  assert.deepEqual(closedResult(classify({ message: 'PID namespace supported; Network namespaces supported' })).startupDetails,
    ['PID_NAMESPACES_SUPPORTED', 'NETWORK_NAMESPACES_SUPPORTED']);
});

test('all six original signal categories and every original alternative', () => {
  for (const [expected, messages] of signals) {
    for (const message of messages) {
      for (const text of [message, message.toLowerCase(), message.toUpperCase()]) {
        assert.equal(closedResult(classify({ message: text })).startupSignal, expected);
      }
    }
  }
});

test('all original signal priorities win over every later category regardless of text order', () => {
  for (let i = 0; i < signals.length; i++) {
    for (let j = i + 1; j < signals.length; j++) {
      for (const message of [signals[i][1][0] + '\n' + signals[j][1][0], signals[j][1][0] + '\n' + signals[i][1][0]]) {
        assert.equal(closedResult(classify({ message })).startupSignal, signals[i][0]);
      }
    }
  }
});

test('original word boundaries and UNKNOWN fallback remain closed', () => {
  for (const message of ['', 'unclassified', 'Protocol errors', 'Target closedown', 'preTimeout', 'TimeoutErrorSuffix', 'retimed outwards']) {
    assert.deepEqual(closedResult(classify({ message })), unknown);
  }
});

test('old collapsed sandbox messages now yield distinct closed observations, not causes', () => {
  const cases = [
    ['No usable sandbox!', ['NO_USABLE_SANDBOX']],
    ['Failed to move to new namespace: PID namespaces supported, Network namespace supported, but failed: errno = 1 (Operation not permitted)',
      ['NEW_NAMESPACE_FAILED', 'PID_NAMESPACES_SUPPORTED', 'NETWORK_NAMESPACES_SUPPORTED', 'OPERATION_NOT_PERMITTED']],
    ['The SUID sandbox helper binary was found, but is not configured correctly.', ['SUID_SANDBOX_MESSAGE', 'SUID_HELPER_MISCONFIGURED']]
  ];
  for (const [message, startupDetails] of cases) {
    assert.deepEqual(closedResult(classify({ message })), { startupSignal: 'SANDBOX_MESSAGE', startupDetails });
  }
});

test('null, primitives, missing/non-string/boxed messages do not stringify or classify', () => {
  for (const error of [null, undefined, false, 1, 1n, Symbol('No usable sandbox'), 'No usable sandbox', () => {}, {}, [],
    ...[null, undefined, false, 1, 1n, Symbol('No usable sandbox'), [], {}, new String('No usable sandbox')].map(message => ({ message }))]) {
    assert.deepEqual(closedResult(classify(error)), unknown);
  }
  assert.deepEqual(closedResult(classify(new Error('Timeout'))), { startupSignal: 'TIMEOUT_MESSAGE', startupDetails: [] });
});

test('own returning/throwing/side-effect message accessors fail closed without any calls', () => {
  assertAccessorFixtures(classify);
});

test('live, nested and revoked proxies fail closed before any property or reflection traps', () => {
  assertProxyFixtures(classify);
});

test('ordinary Error and own primitive data descriptors classify regardless of descriptor flags', () => {
  const expected = { startupSignal: 'SANDBOX_MESSAGE', startupDetails: ['NO_USABLE_SANDBOX'] };
  assert.deepEqual(closedResult(classify(new Error('No usable sandbox'))), expected);
  for (const enumerable of [false, true]) {
    for (const writable of [false, true]) {
      for (const configurable of [false, true]) {
        const error = Object.create(null, { message: { value: 'No usable sandbox', enumerable, writable, configurable } });
        assert.deepEqual(closedResult(classify(error)), expected);
      }
    }
  }
});

test('inherited arbitrary properties and all non-message error fields are never inspected', () => {
  let reads = 0;
  const forbidden = { get() { reads++; throw new Error('RAW_SENTINEL'); } };
  const prototype = Object.create(null);
  for (const key of ['message', 'name', 'stack', 'code', 'errno', 'path', 'error', 'cause', 'stdout', 'stderr', 'toString']) {
    Object.defineProperty(prototype, key, forbidden);
  }
  assert.deepEqual(closedResult(classify(Object.create(prototype))), unknown);
  const error = Object.create(prototype, { message: { value: 'No usable sandbox' } });
  for (const key of ['name', 'stack', 'code', 'errno', 'path', 'error', 'cause', 'stdout', 'stderr', 'toString']) {
    Object.defineProperty(error, key, forbidden);
  }
  assert.deepEqual(closedResult(classify(error)), { startupSignal: 'SANDBOX_MESSAGE', startupDetails: ['NO_USABLE_SANDBOX'] });
  assert.equal(reads, 0);
});

test('32768-character exact limit accepted, oversized messages rejected without prefix classification', () => {
  const combined = details.map(([, text]) => text).join('\n');
  const exact = combined + ' '.repeat(32768 - combined.length);
  assert.equal(exact.length, 32768);
  assert.deepEqual(closedResult(classify({ message: exact })), { startupSignal: 'SANDBOX_MESSAGE', startupDetails: detailCodes });
  for (const message of [exact + ' ', ' '.repeat(32769) + combined]) {
    assert.deepEqual(closedResult(classify({ message })), unknown);
  }
});

test('raw sentinel, numeric errno, names, paths, stack and process streams never leave the helper', () => {
  const sentinel = 'RAW_SENTINEL_7b19';
  const error = { message: `${sentinel} /private/${sentinel} errno = 8675309: Permission denied`,
    name: sentinel, code: sentinel, errno: 8675309, path: sentinel, stack: sentinel, error: sentinel, stdout: sentinel, stderr: sentinel };
  const result = classify(error);
  assert.deepEqual(closedResult(result), { startupSignal: 'UNKNOWN', startupDetails: ['PERMISSION_DENIED'] });
  assert.ok(!JSON.stringify(result).includes(sentinel));
  assert.ok(!JSON.stringify(result).includes('8675309'));
  assert.deepEqual(closedResult(classify({ message: `${sentinel} errno = 1; EPERM EACCES EROFS; Ubuntu AppArmor NoNewPrivs` })), unknown);
});

test('catch and both receipt joins retain the closed helper fields (source-only)', () => {
  assert.match(source, /runtimeFailure = \{ phase, code: phase === 'BROWSER_PROOF' \? 'BROWSER_PROCESS_PROOF_REQUIRED' : 'APP_OPERATION_FAILED', secondaryCodes, \.\.\.startupDiagnostics\(error\), binding: bindingDiagnostics\.get\(error\) \};/);
  const result = source.split('\n').find(line => line.includes("save('RESULT.json',"));
  const failure = source.split('\n').find(line => line.includes("save('FAILURE-' + MODE + '.json',"));
  assert.match(result, /startupSignal: runtimeFailure\?\.startupSignal \|\| null, startupDetails: runtimeFailure\?\.startupDetails \|\| \[\], secondaryCodes,/);
  assert.match(failure, /startupSignal: runtimeFailure\.startupSignal \|\| null, startupDetails: runtimeFailure\.startupDetails \|\| \[\], secondaryCodes: runtimeFailure\.secondaryCodes/);
});

test('fixtures reject individual detail deletion, raw returns and accessor/proxy guard mutations', () => {
  for (const code of detailCodes) {
    const mutant = helperSource.replace(new RegExp("^      \\['" + code + "',.*\\n", 'm'), '');
    assert.notEqual(mutant, helperSource, code + ' mutation must change the helper');
    assert.throws(() => assertDetailFixtures(loadHelper(mutant)), assert.AssertionError, code + ' deletion must fail');
  }
  for (const raw of ['message', 'error']) {
    const mutant = helperSource.replace('return { startupSignal, startupDetails };', `return { startupSignal, startupDetails, ${raw} };`);
    assert.notEqual(mutant, helperSource, raw + ' mutation must change the helper');
    assert.throws(() => assertDetailFixtures(loadHelper(mutant)), assert.AssertionError, raw + ' return must fail');
  }
  for (const [before, after, fixtures] of [
    ["    if (!descriptor || !Object.hasOwn(descriptor, 'value')) return unknown;\n    const message = descriptor.value;",
      '    const message = error.message;', assertAccessorFixtures],
    [' || isProxy(error)', '', assertProxyFixtures],
    [' || isProxy(error)', ' || (Reflect.ownKeys(error), isProxy(error))', assertProxyFixtures]
  ]) {
    const mutant = helperSource.replace(before, after);
    assert.notEqual(mutant, helperSource, 'guard mutation must change the helper');
    assert.throws(() => fixtures(loadHelper(mutant)), assert.AssertionError, 'guard mutation must fail');
  }
});
