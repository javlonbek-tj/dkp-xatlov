import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { prisma } from './src/db.js';
import { hashPassword } from './src/password.js';

const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
const username = `qa-p6t1-${suffix}`;
const password = 'Temporary-QA-Only-2026!';

try {
  const admin = await prisma.user.create({
    data: { username, fullName: 'P6-T1 vaqtinchalik administrator', role: 'ADMIN', passwordHash: await hashPassword(password) },
    select: { id: true },
  });
  await writeFile(new URL('./.qa-fixtures.json', import.meta.url), JSON.stringify({ adminId: admin.id, username, password }, null, 2), { flag: 'wx' });
  process.stdout.write(JSON.stringify({ adminId: admin.id, username }));
} finally {
  await prisma.$disconnect();
}
