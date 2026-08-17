// One-time bootstrap for the first SUPER_ADMIN account. Deliberately NOT
// exposed via any API route — a public super-admin-creation endpoint would
// undermine the whole point of gating school/admin creation behind it.
//
// Usage: npx ts-node scripts/create-super-admin.ts <name> <email> <password>
import { prisma } from '../src/config/db';
import { hashPassword } from '../src/shared/utils/hash';

const [name, email, password] = process.argv.slice(2);

if (!name || !email || !password) {
  console.error('Usage: npx ts-node scripts/create-super-admin.ts <name> <email> <password>');
  process.exit(1);
}

if (password.length < 6) {
  console.error('Password must be at least 6 characters');
  process.exit(1);
}

(async () => {
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.error(`A user with email ${email} already exists (role: ${existing.role})`);
    process.exit(1);
  }

  const passwordHash = await hashPassword(password);

  const superAdmin = await prisma.user.create({
    data: {
      name,
      email,
      passwordHash,
      role:     'SUPER_ADMIN',
      schoolId: null,
    },
  });

  console.log(`✅ SUPER_ADMIN created: ${superAdmin.email} (id: ${superAdmin.id})`);
  await prisma.$disconnect();
})().catch(async (err) => {
  console.error('Failed to create super admin:', err);
  await prisma.$disconnect();
  process.exit(1);
});
