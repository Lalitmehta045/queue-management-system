const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const migrations = await prisma.$queryRaw`SELECT migration_name, finished_at, applied_steps_count, logs FROM _prisma_migrations;`;
  console.log('Migrations:', migrations);

  try {
    const tokens = await prisma.$queryRaw`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Token';`;
    console.log('Token columns:', tokens);
  } catch (e) {
    console.error('Error fetching Token columns', e);
  }
  
  try {
    const seq = await prisma.$queryRaw`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'TokenSequence';`;
    console.log('TokenSequence columns:', seq);
  } catch (e) {
    console.error('Error fetching TokenSequence columns', e);
  }
  
  try {
    const types = await prisma.$queryRaw`SELECT typname FROM pg_type WHERE typname IN ('TokenType', 'SpecialCategory');`;
    console.log('Types:', types);
  } catch (e) {
    console.error('Error fetching types', e);
  }
  
  try {
    const indexes = await prisma.$queryRaw`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'TokenSequence';`;
    console.log('TokenSequence indexes:', indexes);
  } catch (e) {
    console.error('Error fetching indexes', e);
  }
}

main().catch(console.error).finally(() => prisma.$disconnect());
