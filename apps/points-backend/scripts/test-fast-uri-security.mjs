// Behavioral regression tests for the fast-uri 3.1.9 security patch release.
// Covers GHSA-w74x-v6f9-j3xg, GHSA-xhq7-xmqj-769h, GHSA-wjr9-j795-jxcr and
// GHSA-333x-w4r6-6crp against the actually installed fast-uri, plus a purely
// local Ajv $id/$ref compile/validate pass (Ajv resolves URIs through fast-uri).
// Behavior is asserted before any version metadata: vulnerable versions must
// fail these assertions, not a version string check.
// Pure Node built-ins plus the installed fast-uri/ajv modules; no network,
// server, SDK or config access.

import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const fastUri = require('fast-uri');
const Ajv = require('ajv');

const MALFORMED_SCHEME_ERROR = 'URI scheme is malformed.';
const MALFORMED_HOST_ERROR = 'URI host is malformed.';

// GHSA-w74x-v6f9-j3xg: a percent-encoded or %uXXXX scheme must not decode into
// a live javascript/data/vbscript scheme.
for (const trigger of ['%6Aavascript:alert(1)', '%u006Aavascript:1']) {
  const parsed = fastUri.parse(trigger);
  assert.equal(parsed.error, MALFORMED_SCHEME_ERROR, trigger);
  assert.notEqual(parsed.scheme, 'javascript', trigger);
  assert.equal(fastUri.normalize(trigger), trigger, `normalize must pass through ${trigger}`);
  assert.equal(fastUri.equal(trigger, trigger), false, `equal must fail closed for ${trigger}`);
  assert.throws(
    () => fastUri.resolve('https://example.com/app/', trigger),
    /URI scheme is malformed\./,
    `resolve must reject ${trigger}`,
  );
}
assert.equal(fastUri.equal('%68ttp://a/', 'http://a/'), false, 'encoded scheme must not alias a plain scheme');

// GHSA-xhq7-xmqj-769h: normalizing a relative-path reference must not change
// its resolution target (leading ".." segments stay put).
assert.equal(fastUri.normalize('../x'), '../x', 'leading .. must survive normalization');
assert.equal(fastUri.normalize('./../x'), '../x');
assert.equal(fastUri.normalize('a/../b'), 'b', 'in-range dot removal keeps the same target');
assert.equal(fastUri.equal('../x', 'x'), false, 'distinct relative targets must not compare equal');
for (const ref of ['../x', './../x', 'a/../b', 'x/..']) {
  assert.equal(
    fastUri.resolve('http://h/p/q/r', fastUri.normalize(ref)),
    fastUri.resolve('http://h/p/q/r', ref),
    `normalization must not change the resolution target of ${ref}`,
  );
}
assert.equal(fastUri.normalize('.//x'), './/x', 'normalization must not introduce an authority');

// GHSA-wjr9-j795-jxcr: a malformed authority (@ smuggling, TAB/CR/LF in host)
// must not silently become a clean host.
for (const trigger of [
  'http://a@b@evil.example/',
  'http://user@ev\til.example/path',
  'http://user@ev\nil.example/path',
  'http://user@ev\ril.example/path',
]) {
  const parsed = fastUri.parse(trigger);
  assert.equal(parsed.error, MALFORMED_HOST_ERROR, JSON.stringify(trigger));
  assert.notEqual(parsed.host, 'evil.example', JSON.stringify(trigger));
  assert.equal(fastUri.normalize(trigger), trigger, `normalize must pass through ${JSON.stringify(trigger)}`);
  assert.equal(fastUri.equal(trigger, 'http://user@evil.example/path'), false, JSON.stringify(trigger));
}
assert.equal(fastUri.parse('http://a@b@evil.example/').userinfo, 'a', 'userinfo boundary must not move');
assert.throws(
  () => fastUri.resolve('http://trusted.example/', '//user@b@evil.example/path'),
  /URI host is malformed\./,
  'resolve must reject an @-smuggled authority',
);

// GHSA-333x-w4r6-6crp: suffix serialization must not emit a live first-segment
// scheme; it either percent-escapes the colon or fails closed.
const suffixSerialized = fastUri.serialize(
  { scheme: 'x', path: 'javascript:alert(1)' },
  { reference: 'suffix' },
);
assert.equal(suffixSerialized, 'javascript%3Aalert(1)', 'suffix output must escape the first-segment colon');
assert.equal(fastUri.parse(suffixSerialized).scheme, undefined, 'suffix output must not reparse as a scheme');
// normalize() parses a suffix reference in the context of options.scheme and
// never emits that scheme token; the first-segment colon is percent-escaped so
// the output reparses as a scheme-less path (upstream
// test/reserved-path-normalization.test.js lines 115-136).
const suffixOptions = { reference: 'suffix', scheme: 'x' };
for (const [trigger, escaped] of [
  ['javascript:alert(1)', 'javascript%3Aalert(1)'],
  ['data:text/html,x', 'data%3Atext/html,x'],
]) {
  const suffixNormalized = fastUri.normalize(trigger, suffixOptions);
  assert.equal(suffixNormalized, escaped, `suffix normalization must escape the first-segment colon of ${trigger}`);
  assert.equal(fastUri.parse(suffixNormalized).scheme, undefined, `default parse of "${suffixNormalized}" must not yield a scheme`);
}
assert.equal(fastUri.normalize('path/to/file', suffixOptions), 'path/to/file', 'plain path unchanged');
assert.equal(fastUri.normalize('a/b:c', suffixOptions), 'a/b:c', 'colon in a later segment stays literal');

// Controls: ordinary absolute, relative and percent-escaped URIs keep their
// valid semantics, including valid //host references, query/fragment data and
// component-specific escapes (no blanket RFC-vs-WHATWG equality).
assert.equal(fastUri.normalize('http://Example.COM/'), 'http://example.com/');
assert.equal(fastUri.normalize('http://h/a/../../b'), 'http://h/b', 'merged absolute paths still collapse');
assert.equal(fastUri.normalize('/a/../b'), '/b', 'root-relative dot removal is unchanged');
assert.equal(fastUri.resolve('http://h/p/q/r', '../x'), 'http://h/p/x');
assert.equal(
  fastUri.resolve('http://trusted.example/', '//user@example.com/p'),
  'http://user@example.com/p',
  'valid network-path reference is preserved',
);
assert.equal(fastUri.parse('http://user:pass@example.com:8080/').host, 'example.com');
assert.equal(fastUri.parse("http://a!$&'()*+,;=b.example/").error, undefined, 'sub-delims stay valid');
assert.equal(fastUri.normalize('a/../b?q#f'), 'b?q#f', 'query and fragment survive relative normalization');
assert.equal(
  fastUri.normalize('http://example.com/a%2Fb'),
  'http://example.com/a%2Fb',
  'reserved path escapes stay encoded data',
);
assert.equal(fastUri.serialize({ path: 'foo:bar' }), 'foo%3Abar', 'path-noscheme colon escaping is kept');
assert.equal(fastUri.serialize({ query: 'a/b?c', fragment: 'd/e?f' }), '?a/b?c#d/e?f', 'query/fragment literal sets are kept');

// Ajv resolves $id/$ref through its uriResolver, which is the installed
// fast-uri; assert that both this test and Ajv load the same module file.
const fastUriPath = require.resolve('fast-uri');
const ajvRequire = createRequire(require.resolve('ajv'));
assert.equal(
  ajvRequire.resolve('fast-uri'),
  fastUriPath,
  'Ajv must resolve the same installed fast-uri module',
);

const ajv = new Ajv();
ajv.addSchema({
  $id: 'https://points.local/schemas/wallet.json',
  type: 'object',
  properties: {
    wallet: { type: 'string', pattern: '^0x[0-9a-fA-F]{40}$' },
  },
  required: ['wallet'],
  additionalProperties: false,
});
const validateEvent = ajv.compile({
  $id: 'https://points.local/schemas/event.json',
  type: 'object',
  properties: {
    wallet: { $ref: 'wallet.json#/properties/wallet' },
    amount: { type: 'integer' },
  },
  required: ['wallet', 'amount'],
  additionalProperties: false,
});
const validWallet = `0x${'a'.repeat(40)}`;
assert.equal(validateEvent({ wallet: validWallet, amount: 5 }), true, 'local $id/$ref with fragment validates');
assert.equal(validateEvent({ wallet: 'not-a-wallet', amount: 5 }), false, 'fragment-referenced pattern applies');
assert.equal(validateEvent({ amount: 5 }), false, 'required property applies');

const version = require('fast-uri/package.json').version;
console.log(`fast-uri security behavior passed (installed fast-uri ${version} at ${fastUriPath}).`);
