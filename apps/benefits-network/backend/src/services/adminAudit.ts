import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Request } from 'express';

type AdminAuditTarget = {
  type?: string;
  id?: string;
};

function digest(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

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
    clientDigest: digest(`admin-client:${request.ip || 'unknown'}`),
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
