const fs = require('fs');
const path = require('path');
const p = path.resolve('apps/api/src/displays/displays.service.ts');
let content = fs.readFileSync(p, 'utf8');

const newSelect = `  private readonly publicTokenSelect = {
    id: true,
    displayNumber: true,
    type: true,
    status: true,
    calledAt: true,
    recalledAt: true,
    recallCount: true,
    counterId: true,
    issuedAt: true,
    createdAt: true,
    sequenceNumber: true,
    counter: { select: { name: true, code: true } },
    queueEntry: { select: { priorityWeight: true, service: { select: { name: true, department: { select: { name: true } } } } } },
  } satisfies Prisma.TokenSelect;`;

content = content.replace(/private readonly publicTokenSelect = \{[^]*?\} satisfies Prisma\.TokenSelect;/, newSelect);

const newRow = `type PublicTokenRow = {
  id: string;
  displayNumber: string;
  type: string;
  status: TokenStatus;
  calledAt: Date | null;
  recalledAt: Date | null;
  recallCount: number;
  counterId: string | null;
  issuedAt: Date | null;
  createdAt: Date;
  sequenceNumber: number;
  counter: { name: string; code: string } | null;
  queueEntry?: { priorityWeight: number; service: { name: string; department: { name: string } } } | null;
};`;

content = content.replace(/type PublicTokenRow = \{[^]*?\};/, newRow);

fs.writeFileSync(p, content);
