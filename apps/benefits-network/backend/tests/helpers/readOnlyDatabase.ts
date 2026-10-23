import type { Prisma, PrismaClient } from '@prisma/client';

const READ_ACTIONS = new Set([
  'findUnique', 'findUniqueOrThrow', 'findFirst', 'findFirstOrThrow',
  'findMany', 'count', 'aggregate', 'groupBy',
]);

export function createReadOnlyDatabaseAssertion(prisma: PrismaClient) {
  // Row snapshots alone would miss no-op updates or writes to another table.
  // Middleware also sees raw operations and writes inside transactions.
  let observed: Array<Pick<Prisma.MiddlewareParams, 'model' | 'action'>> | null = null;
  prisma.$use(async (params, next) => {
    observed?.push({ model: params.model, action: params.action });
    return next(params);
  });

  return async function expectNoDatabaseWrites<T>(read: () => Promise<T>): Promise<T> {
    const actions: NonNullable<typeof observed> = [];
    observed = actions;
    let result: T;
    try {
      result = await read();
    } finally {
      observed = null;
    }
    expect(actions.filter(({ action }) => !READ_ACTIONS.has(action))).toEqual([]);
    return result;
  };
}
