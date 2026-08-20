const { NestFactory } = require('@nestjs/core');
const { AppModule } = require('./dist/app.module');
const { CountersService } = require('./dist/operations/counters.service');

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { logger: false });
  const countersService = app.get(CountersService);
  try {
    // Valid UUID for tenant
    const tenant = { organizationId: 'a1234567-89ab-cdef-0123-456789abcdef', id: 'a1234567-89ab-cdef-0123-456789abcdef', role: 'ADMIN' };
    
    // We mock authorizeBranch to just resolve to avoid branch errors
    countersService.authorizeBranch = async () => true;

    const result = await countersService.list(tenant, '5ca3bfb1-7346-4aea-81e2-f99c329ed1cc', { page: 1, limit: 10 });
    console.log('Success:', result);
  } catch (err) {
    console.error('Error from NestJS CountersService:', err.message);
  }
  await app.close();
}
bootstrap();
