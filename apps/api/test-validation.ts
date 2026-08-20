import { validate } from 'class-validator';
import { GenerateTokenDto } from './src/tokens/dto/generate-token.dto.js';
import { plainToInstance } from 'class-transformer';

async function main() {
  const payload = { type: 'SPECIAL', specialCategory: 'SENIOR_CITIZEN' };
  const dto = plainToInstance(GenerateTokenDto, payload);
  console.log('DTO:', dto);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  console.log('Validation errors:', errors);
}

main();
