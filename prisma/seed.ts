import { PrismaClient, Role, MembershipStatus, OrganizationStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

async function main() {
  const email = process.env.SEED_USER_EMAIL;
  const password = process.env.SEED_USER_PASSWORD;
  const displayName = process.env.SEED_USER_NAME || 'Admin User';

  if (!email || !password) {
    console.error(
      '❌ Missing required env vars. Set SEED_USER_EMAIL and SEED_USER_PASSWORD before running the seed.',
    );
    process.exit(1);
  }

  if (password.length < 8) {
    console.error('❌ SEED_USER_PASSWORD must be at least 8 characters.');
    process.exit(1);
  }

  // Skip if the user already exists
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`ℹ️  User "${email}" already exists — skipping seed.`);
    return;
  }

  const passwordHash = await bcrypt.hash(password, 10);

  const slug =
    displayName.toLowerCase().replace(/[^a-z0-9]/g, '-') +
    '-' +
    crypto.randomBytes(4).toString('hex');

  await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        displayName,
      },
    });

    const organization = await tx.organization.create({
      data: {
        name: `${displayName}'s Organization`,
        slug,
        status: OrganizationStatus.ACTIVE,
      },
    });

    await tx.membership.create({
      data: {
        userId: user.id,
        organizationId: organization.id,
        role: Role.ORG_ADMIN,
        status: MembershipStatus.ACTIVE,
      },
    });

    console.log(`✅ Seeded user "${email}" (${user.id})`);
    console.log(`   Organization: "${organization.name}" (${organization.id})`);
    console.log(`   Role: ORG_ADMIN`);
  });
}

main()
  .catch((e) => {
    console.error('Seed failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
