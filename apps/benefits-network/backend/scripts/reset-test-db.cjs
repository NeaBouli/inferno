const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const dbPath = path.join(root, 'prisma', 'test.db');
const migrationsDir = path.join(root, 'prisma', 'migrations');

fs.rmSync(dbPath, { force: true });

const migrationFiles = fs
  .readdirSync(migrationsDir, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => path.join(migrationsDir, entry.name, 'migration.sql'))
  .filter((file) => fs.existsSync(file))
  .sort();

for (const file of migrationFiles) {
  execFileSync('sqlite3', [dbPath, `.read ${file}`], { stdio: 'inherit' });
}
