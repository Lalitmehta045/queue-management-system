const { ValidationPipe } = require('@nestjs/common');
const { ListTokensDto } = require('./dist/tokens/dto/list-tokens.dto');

async function test() {
  const pipe = new ValidationPipe({ transform: true, whitelist: true });
  
  const reqQuery = {
    page: '1',
    limit: '20'
  };

  try {
    const transformed = await pipe.transform(reqQuery, { type: 'query', metatype: ListTokensDto });
    console.log("Transformed:", transformed);
  } catch (e) {
    console.log("Validation error:", e.response);
  }
}
test();
