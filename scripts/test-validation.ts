import 'reflect-metadata';
import { ValidationPipe } from '@nestjs/common';
import { GenerateTokenDto } from '../apps/api/src/tokens/dto/generate-token.dto';
import { BulkGenerateTokenDto } from '../apps/api/src/tokens/dto/bulk-generate-token.dto';

async function main() {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  try {
    const obj = { type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' };
    const validated = await pipe.transform(obj, { type: 'body', metatype: GenerateTokenDto });
    console.log('GenerateTokenDto Result:', validated);
  } catch (e) {
    console.log('GenerateTokenDto Error:', e.response);
  }

  try {
    const obj = { serviceId: 'dummy', priority: 'NORMAL', quantity: 2, type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' };
    const validated = await pipe.transform(obj, { type: 'body', metatype: BulkGenerateTokenDto });
    console.log('BulkGenerateTokenDto Result:', validated);
  } catch (e) {
    console.log('BulkGenerateTokenDto Error:', e.response);
  }
}

main().catch(console.error);
