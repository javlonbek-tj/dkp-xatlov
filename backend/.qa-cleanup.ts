import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { prisma } from './src/db.js';

const fixtures = JSON.parse(await readFile(new URL('./.qa-fixtures.json', import.meta.url), 'utf8')) as Record<string, string>;
const qaUserIds = [fixtures.adminId, fixtures.republic1Id, fixtures.republic2Id, fixtures.regionalId];
const districtIds = [fixtures.district1Id, fixtures.district2Id];
const recordIds = {
  xatlovRecord: [fixtures.xatlov1Id, fixtures.xatlov2Id],
  mkdRecord: [fixtures.mkdId],
  radLimit: [fixtures.radId],
  overdueApplication: [fixtures.overdueId],
  callLog: [fixtures.callId],
};

try {
  const [users, region, districts] = await Promise.all([
    prisma.user.findMany({ where: { id: { in: qaUserIds } }, select: { id: true, username: true } }),
    prisma.region.findUnique({ where: { id: fixtures.regionId }, select: { id: true, name: true } }),
    prisma.district.findMany({ where: { id: { in: districtIds } }, select: { id: true, regionId: true } }),
  ]);
  if (users.length !== qaUserIds.length || users.some((user) => !user.username.startsWith('qa-p6t1-'))) {
    throw new Error('QA user ownership check failed; no data was deleted.');
  }
  if (!region || !region.name.startsWith('P6-T1 QA hudud qa-p6t1-')) {
    throw new Error(`QA region ownership check failed (${region?.name ?? 'missing'}); no data was deleted.`);
  }
  if (districts.length !== districtIds.length || districts.some((district) => district.regionId !== region.id)) {
    throw new Error('QA district ownership check failed; no data was deleted.');
  }
  for (const [model, ids] of Object.entries(recordIds)) {
    const rows = await (prisma[model as keyof typeof recordIds] as any).findMany({ where: { id: { in: ids } }, select: { id: true, districtId: true } });
    if (rows.length !== ids.length || rows.some((row: { districtId: string }) => !districtIds.includes(row.districtId))) {
      throw new Error(`QA ${model} ownership check failed; no data was deleted.`);
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.xatlovRecord.deleteMany({ where: { districtId: { in: districtIds } } });
    await tx.mkdRecord.deleteMany({ where: { districtId: { in: districtIds } } });
    await tx.radLimit.deleteMany({ where: { districtId: { in: districtIds } } });
    await tx.overdueApplication.deleteMany({ where: { districtId: { in: districtIds } } });
    await tx.callLog.deleteMany({ where: { districtId: { in: districtIds } } });
    await tx.region.update({ where: { id: fixtures.regionId }, data: { groupLeaderAssignmentId: null } });
    await tx.district.deleteMany({ where: { id: { in: districtIds } } });
    await tx.employeeRegionAssignment.deleteMany({ where: { id: { in: [fixtures.assignmentRep1Id, fixtures.assignmentRep2Id, fixtures.assignmentRegionalId] } } });
    await tx.region.delete({ where: { id: fixtures.regionId } });
    await tx.user.deleteMany({ where: { id: { in: qaUserIds } } });
  });
  process.stdout.write('Deleted the verified P6-T1 temporary QA records, geography, assignments, and users.');
} finally {
  await prisma.$disconnect();
}
