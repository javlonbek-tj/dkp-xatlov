import 'dotenv/config';
import { prisma } from './src/db.js';

try {
  await prisma.$transaction(async (transaction) => {
    await transaction.region.create({ data: { name: `P6-T1 rollback probe ${Date.now()}` } });
    throw new Error('QA_ROLLBACK');
  });
} catch (error) {
  const err = error as { message?: string; code?: string; meta?: unknown };
  if (err.message !== 'QA_ROLLBACK') process.stdout.write(JSON.stringify({ message: err.message, code: err.code, meta: err.meta }));
}
await prisma.$disconnect();
