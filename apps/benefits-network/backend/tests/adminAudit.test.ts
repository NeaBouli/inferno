import { createHash, createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

jest.mock('../src/config', () => ({ config: {
  ADMIN_AUDIT_HMAC_KEY: 'test-audit-hmac-key-0123456789abcdef',
} }));

import { config } from '../src/config';
import { adminAuditData, recordAdminAudit } from '../src/services/adminAudit';

const testKey = 'test-audit-hmac-key-0123456789abcdef';
const request = (ip?: string) => ({
  ip, method: 'POST', baseUrl: '/api/admin', path: '/businesses/resource-id',
  route: { path: '/businesses/:id' },
}) as Request;

afterEach(() => { config.ADMIN_AUDIT_HMAC_KEY = testKey; });

test.each(['203.0.113.7', '2001:db8::7', undefined])('uses a keyed client digest for %s', (ip) => {
  const audit = adminAuditData(request(ip), 'business:create', 201, { type: 'Business', id: 'resource-id' });
  const input = `admin-client:${ip || 'unknown'}`;
  expect(audit.clientDigest).toBe(createHmac('sha256', testKey).update(input).digest('hex'));
  expect(audit.clientDigest).not.toBe(createHash('sha256').update(input).digest('hex'));
  expect(audit.actorDigest).toBe(createHash('sha256').update('admin-actor:primary').digest('hex'));
  expect(audit).toMatchObject({
    action: 'business:create', method: 'POST', routeTemplate: '/api/admin/businesses/:id',
    targetType: 'Business', targetId: 'resource-id', statusCode: 201,
  });
  if (ip) expect(JSON.stringify(audit)).not.toContain(ip);
  expect(JSON.stringify(audit)).not.toContain(testKey);
});

test('key rotation changes only the new client digest, preserving the role marker', () => {
  const first = adminAuditData(request('203.0.113.7'), 'business:create', 201);
  config.ADMIN_AUDIT_HMAC_KEY = 'rotated-test-audit-key-0123456789abcdef';
  const second = adminAuditData(request('203.0.113.7'), 'business:create', 201);
  expect(second.clientDigest).not.toBe(first.clientDigest);
  expect(second.actorDigest).toBe(first.actorDigest);
  expect(adminAuditData(request('203.0.113.8'), 'business:create', 201).clientDigest)
    .not.toBe(second.clientDigest);
});

test('records the HMAC in the existing transaction without rewriting old rows', async () => {
  const create = jest.fn().mockResolvedValue({ id: 'new-audit' });
  const transaction = { adminAuditLog: { create } } as unknown as Prisma.TransactionClient;
  await expect(recordAdminAudit(transaction, request('203.0.113.7'), 'business:create', 201))
    .resolves.toEqual({ id: 'new-audit' });
  expect(create).toHaveBeenCalledWith({
    data: adminAuditData(request('203.0.113.7'), 'business:create', 201),
  });
  expect(create).toHaveBeenCalledTimes(1);
});
