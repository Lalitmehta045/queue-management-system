const fs = require('fs');
const path = require('path');
const dir = 'apps/api/test';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts'));

const toRemove1 = `    await prisma.counterAssignment.deleteMany({});\n    await prisma.counter.deleteMany({});\n    await prisma.printer.deleteMany({});\n    await prisma.display.deleteMany({});\n    await prisma.branchWorkingHours.deleteMany({});\n    await prisma.notificationSetting.deleteMany({});\n    await prisma.notification.deleteMany({});\n`;
const toRemove2 = `    await prisma.counterAssignment.deleteMany({});\r\n    await prisma.counter.deleteMany({});\r\n    await prisma.printer.deleteMany({});\r\n    await prisma.display.deleteMany({});\r\n    await prisma.branchWorkingHours.deleteMany({});\r\n    await prisma.notificationSetting.deleteMany({});\r\n    await prisma.notification.deleteMany({});\r\n`;

for (const f of files) {
  const filePath = path.join(dir, f);
  let content = fs.readFileSync(filePath, 'utf8');
  if (content.includes('await prisma.counterAssignment.deleteMany({});')) {
    content = content.replace(toRemove1, '');
    content = content.replace(toRemove2, '');
    fs.writeFileSync(filePath, content);
    console.log('Fixed', f);
  }
}
