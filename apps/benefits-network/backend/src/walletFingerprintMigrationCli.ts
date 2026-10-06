import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { migrateCustomerWallets } from './services/walletFingerprintMigration';

/**
 * T-231a one-off data migration (operator-run, never at startup):
 *   node dist/walletFingerprintMigrationCli.js report
 *   node dist/walletFingerprintMigrationCli.js apply --confirm=HASH_CUSTOMER_WALLETS
 * Reads CUSTOMER_WALLET_HMAC_KEY and DATABASE_URL from the environment; prints counts only.
 */
export function parseWalletMigrationArgs(argv: string[]) {
  const mode = argv[2];
  if (mode !== 'report' && mode !== 'apply') throw new Error('Mode must be report or apply');
  const args = argv.slice(3);
  const allowed = mode === 'apply' ? ['--confirm='] : [];
  if (args.some((value) => !allowed.some((prefix) => value.startsWith(prefix)))) {
    throw new Error('Unknown wallet migration argument');
  }
  const confirms = args.filter((value) => value.startsWith('--confirm='));
  if (mode === 'apply' && confirms.length !== 1) throw new Error('Exactly one --confirm=... argument is required');
  return { mode: mode as 'report' | 'apply', confirmation: confirms[0]?.slice('--confirm='.length) };
}

async function main() {
  const parsed = parseWalletMigrationArgs(process.argv);
  const db = new PrismaClient();
  try {
    const output = await migrateCustomerWallets(db, {
      key: process.env.CUSTOMER_WALLET_HMAC_KEY,
      mode: parsed.mode,
      confirmation: parsed.confirmation,
    });
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
  } finally {
    await db.$disconnect();
  }
}

if (require.main === module) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Wallet migration failed'}\n`);
    process.exitCode = 1;
  });
}
