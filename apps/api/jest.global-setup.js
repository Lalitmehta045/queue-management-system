/**
 * Jest global setup — routes all e2e tests to a dedicated local test database
 * (smart_queue_test) so test runs NEVER wipe the development database.
 *
 * This runs once before the test suite. Because `npm test` uses `jest --runInBand`,
 * setting process.env.DATABASE_URL here is visible to every test in the same process.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { PrismaClient } = require('@prisma/client');

const TEST_DB_NAME = 'smart_queue_test';

function loadEnvFile(file) {
  const out = {};
  if (!fs.existsSync(file)) return out;
  const txt = fs.readFileSync(file, 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function swapDatabaseName(url, dbName) {
  return url.replace(/\/([^/?]+)(\?|$)/, `/${dbName}$2`);
}

module.exports = async function globalSetup() {
  const root = path.resolve(__dirname, '../..');
  const env = loadEnvFile(path.join(root, '.env'));

  const devUrl = process.env.DATABASE_URL || env.DATABASE_URL;
  if (!devUrl || !/postgresql:\/\//.test(devUrl)) {
    throw new Error('[jest.global-setup] DATABASE_URL not found or invalid. Cannot provision test database.');
  }

  const testDbUrl = swapDatabaseName(devUrl, TEST_DB_NAME);
  const adminUrl = swapDatabaseName(devUrl, 'postgres');

  // 1. Create the test database if it does not exist.
  const admin = new PrismaClient({ datasources: { db: { url: adminUrl } } });
  try {
    const exists = await admin.$queryRawUnsafe(
      `SELECT 1 FROM pg_database WHERE datname = '${TEST_DB_NAME}'`
    );
    if (!exists.length) {
      await admin.$executeRawUnsafe(`CREATE DATABASE "${TEST_DB_NAME}"`);
      console.log(`[jest.global-setup] Created test database "${TEST_DB_NAME}"`);
    }
  } finally {
    await admin.$disconnect();
  }

  // 2. Apply the current migrations to the test database.
  const schemaPath = path.join(root, 'prisma', 'schema.prisma');
  execSync(`npx prisma migrate deploy --schema "${schemaPath}"`, {
    cwd: root,
    env: { ...process.env, DATABASE_URL: testDbUrl },
    stdio: 'pipe',
  });

  // 3. Point the whole test run at the isolated test database.
  process.env.DATABASE_URL = testDbUrl;
  console.log(`[jest.global-setup] Tests will use ${testDbUrl.replace(/\/\/[^@]+@/, '//<creds>@')}`);
};
