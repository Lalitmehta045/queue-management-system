const { PrismaClient } = require('@prisma/client');
const admin = new PrismaClient({ datasources: { db: { url: 'postgresql://postgres:Lalit_45@localhost:5432/postgres?schema=public' } } });
admin.$executeRawUnsafe('DROP DATABASE IF EXISTS smart_queue_test WITH (FORCE);')
  .then(() => console.log('Dropped'))
  .catch(e => console.error(e))
  .finally(() => admin.$disconnect());
