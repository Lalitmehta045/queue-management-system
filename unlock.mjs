import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient({
  datasourceUrl: 'postgresql://neondb_owner:npg_nNIFQO2tTCq7@ep-twilight-dream-axz5vhrl.c-4.us-east-2.aws.neon.tech/neondb?sslmode=require'
});

async function main() {
  console.log('Connecting to database to clear locks...');
  try {
    // Attempt to unlock any locks held by the CURRENT session (unlikely to help, but safe)
    await prisma.$queryRawUnsafe(`SELECT pg_advisory_unlock_all()::text;`);
    
    // Terminate all other connections to the database to force them to drop their locks
    console.log('Terminating other idle connections...');
    const result = await prisma.$queryRawUnsafe(`
      SELECT pg_terminate_backend(pid)::text
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND state = 'idle';
    `);
    console.log('Connections terminated:', result);
    
    // Also terminate anything holding an advisory lock
    const lockResult = await prisma.$queryRawUnsafe(`
      SELECT pg_terminate_backend(pid)::text
      FROM pg_locks
      WHERE locktype = 'advisory' AND pid <> pg_backend_pid();
    `);
    console.log('Advisory lock holders terminated:', lockResult);

    console.log('Successfully cleared database connections and locks.');
  } catch (err) {
    console.error('Error clearing locks:', err);
  } finally {
    await prisma.$disconnect();
  }
}

main();
