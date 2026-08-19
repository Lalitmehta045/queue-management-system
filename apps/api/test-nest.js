const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { TokensService } = require('./dist/tokens/tokens.service');

async function test() {
  const app = await NestFactory.createApplicationContext(AppModule);
  const tokensService = app.get(TokensService);
  
  const tenant = {
    organizationId: 'c0e44a57-fc62-4f4c-8f29-827b15c31b7d',
    role: 'ORG_ADMIN',
    branchId: null
  };
  const branchId = '1a8cdcf5-d623-4a9c-80e2-574f3dfaadc4'; // valid branch id from DB
  const query = {
    page: 1,
    limit: 20,
    businessDate: '2026-08-20'
  };

  try {
    const res = await tokensService.list(tenant, branchId, query);
    console.log("Success:", res);
  } catch(e) {
    console.error("Error from list:");
    console.error(e);
  }
  await app.close();
}
test().catch(console.error);
