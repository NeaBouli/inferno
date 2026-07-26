import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import {
  DEFAULT_RETENTION_BATCH_LIMIT,
  MAX_RETENTION_BATCH_LIMIT,
  applyRetention,
  getRetentionReport,
} from './services/retention';

function argument(argv: string[], name: string) {
  const prefix = `--${name}=`;
  const values = argv.filter((value) => value.startsWith(prefix));
  if (values.length !== 1) throw new Error(`Exactly one --${name}=... argument is required`);
  return values[0].slice(prefix.length);
}

function optionalIntegerArgument(argv: string[], name: string, fallback: number) {
  const prefix = `--${name}=`;
  const values = argv.filter((value) => value.startsWith(prefix));
  if (values.length === 0) return fallback;
  if (values.length !== 1 || !/^\d+$/.test(values[0].slice(prefix.length))) {
    throw new Error(`--${name} must be one positive integer`);
  }
  return Number(values[0].slice(prefix.length));
}

export function parseRetentionCliArgs(argv: string[], nowMs = Date.now()) {
  const mode = argv[2];
  if (!['report', 'apply'].includes(mode)) {
    throw new Error('Mode must be report or apply');
  }
  const args = argv.slice(3);
  const allowedPrefixes = mode === 'apply'
    ? ['--older-than-days=', '--batch-limit=', '--confirm=']
    : ['--older-than-days=', '--batch-limit='];
  if (args.some((value) => !allowedPrefixes.some((prefix) => value.startsWith(prefix)))) {
    throw new Error('Unknown retention argument');
  }
  const daysValue = argument(args, 'older-than-days');
  const days = Number(daysValue);
  const cutoff = cutoffFromDays(daysValue, nowMs);
  const batchLimit = optionalIntegerArgument(args, 'batch-limit', DEFAULT_RETENTION_BATCH_LIMIT);
  if (batchLimit < 1 || batchLimit > MAX_RETENTION_BATCH_LIMIT) {
    throw new Error(`--batch-limit must be between 1 and ${MAX_RETENTION_BATCH_LIMIT}`);
  }
  return {
    mode: mode as 'report' | 'apply',
    cutoff,
    olderThanDays: days,
    batchLimit,
    confirmation: mode === 'apply' ? argument(args, 'confirm') : null,
  };
}

function cutoffFromDays(daysValue: string, nowMs = Date.now()) {
  if (!/^\d+$/.test(daysValue)) throw new Error('--older-than-days must be a positive integer');
  const days = Number(daysValue);
  if (days < 1 || days > 3650) throw new Error('--older-than-days must be between 1 and 3650');
  return new Date(nowMs - days * 24 * 60 * 60 * 1000);
}

async function main() {
  const parsed = parseRetentionCliArgs(process.argv);
  const db = new PrismaClient();
  try {
    const output = parsed.mode === 'report'
      ? await getRetentionReport(db, parsed.cutoff, new Date(), parsed.batchLimit)
      : await applyRetention(db, {
          cutoff: parsed.cutoff,
          batchLimit: parsed.batchLimit,
          confirmation: parsed.confirmation ?? '',
        });
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Retention operation failed'}\n`);
    process.exitCode = 1;
  });
}
