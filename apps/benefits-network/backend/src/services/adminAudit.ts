import { createHash, createHmac } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';
import { config } from '../config';

type AdminAuditTarget = {
  type?: string;
  id?: string;
};

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

/**
 * New client digests use a dedicated server-side HMAC key; the fixed role digest is unchanged.
 * Existing rows retain their legacy unkeyed digests. Key rotation affects only new rows and
 * breaks client correlation across keys; it does not anonymize or rewrite historical rows.
 */
export function adminAuditData(
  request: Request,
  action: string,
  statusCode: number,
  target: AdminAuditTarget = {}
) {
  const routePath = (request.route as { path?: string } | undefined)?.path ?? request.path;
  return {
    action,
    method: request.method,
    routeTemplate: `${request.baseUrl}${routePath}`,
    targetType: target.type ?? null,
    targetId: target.id ?? null,
    actorDigest: digest('admin-actor:primary'),
    clientDigest: createHmac('sha256', config.ADMIN_AUDIT_HMAC_KEY)
      .update(`admin-client:${request.ip || 'unknown'}`).digest('hex'),
    statusCode,
  };
}

export function recordAdminAudit(
  transaction: Prisma.TransactionClient,
  request: Request,
  action: string,
  statusCode: number,
  target?: AdminAuditTarget
) {
  return transaction.adminAuditLog.create({
    data: adminAuditData(request, action, statusCode, target),
  });
}
