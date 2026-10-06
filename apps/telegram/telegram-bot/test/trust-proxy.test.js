const assert = require('node:assert/strict');
const test = require('node:test');
const express = require('express');

// Resolves Express req.ip for a TCP peer and an X-Forwarded-For header under a trust list.
function clientIp(subnets, peer, forwardedFor) {
  const app = express();
  app.set('trust proxy', subnets);
  const socket = { remoteAddress: peer };
  const req = Object.create(app.request);
  Object.defineProperty(req, 'headers', { value: { 'x-forwarded-for': forwardedFor } });
  Object.defineProperty(req, 'socket', { value: socket });
  Object.defineProperty(req, 'connection', { value: socket });
  return req.ip;
}

// Default VERIFY_TRUST_PROXY (src/index.js): the Docker pool Traefik speaks from (CWA-31, T-283).
const DEFAULT_TRUST = ['172.16.0.0/12'];

test('default trust list ignores spoofed X-Forwarded-For from untrusted peers', () => {
  assert.equal(clientIp(DEFAULT_TRUST, '203.0.113.9', '6.6.6.6'), '203.0.113.9');
  assert.equal(clientIp(DEFAULT_TRUST, '::ffff:203.0.113.9', '6.6.6.6'), '::ffff:203.0.113.9');
  assert.equal(clientIp(DEFAULT_TRUST, '2001:db8::9', '6.6.6.6'), '2001:db8::9');
});

test('default trust list resolves the client behind the Traefik hop', () => {
  assert.equal(clientIp(DEFAULT_TRUST, '172.18.0.5', '6.6.6.6, 198.51.100.7'), '198.51.100.7');
  assert.equal(clientIp(DEFAULT_TRUST, '::ffff:172.18.0.5', '198.51.100.7'), '198.51.100.7');
});

// GHSA-jqcg-44mw-7w3h canary: on proxy-addr <= 2.0.7 these subnets trusted every IPv4 peer.
test('patched proxy-addr: zero-prefix IPv6 trust entries no longer trust every IPv4 peer', () => {
  for (const subnet of ['::ffff:10.0.0.0/8', '::/1']) {
    assert.equal(clientIp([subnet], '203.0.113.9', '6.6.6.6'), '203.0.113.9');
  }
  assert.equal(clientIp(['::ffff:10.0.0.0/104'], '10.1.2.3', '198.51.100.7'), '198.51.100.7');
});
