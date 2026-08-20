const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const display = await prisma.display.findFirst();
  console.log("Display ID:", display.publicId);
  const res = await fetch(`http://localhost:4000/public/displays/${display.publicId}/events`);
  // It's Server-Sent Events, we can just read the first event.
  const reader = res.body.getReader();
  const { value } = await reader.read();
  const text = new TextDecoder().decode(value);
  console.log(text);
}
main().catch(console.error).finally(() => prisma.$disconnect());
