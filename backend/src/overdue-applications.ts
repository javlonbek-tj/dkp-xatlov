import express from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { requireAuth, requireDistrictAccess } from './auth.js';
import { prisma } from './db.js';

const router = express.Router();
const districtInclude = {
  region: true,
  republicEmployeeAssignment: { include: { user: { select: { id: true, fullName: true, phone: true } } } },
  regionalEmployeeAssignment: { include: { user: { select: { id: true, fullName: true, phone: true } } } },
} satisfies Prisma.DistrictInclude;
const recordInclude = { district: { include: districtInclude } } satisfies Prisma.OverdueSnapshotInclude;
const stageFields = ['stage1to3', 'stage4to7', 'stage8to14', 'stage15to30', 'stage31to90', 'stage90plus'] as const;

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, 'INVALID_DATE', `${field} must use YYYY-MM-DD format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, 'INVALID_DATE', `Enter a valid ${field.toLowerCase()}`);
  }
  return date;
}

function parsePayload(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_RECORD', 'A record object is required');
  }
  const input = body as Record<string, unknown>;
  for (const key of stageFields) {
    if (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0) {
      throw new ApiError(400, 'INVALID_COUNT', `${key} must be a non-negative whole number`);
    }
  }
  return {
    recordDate: parseDate(input.recordDate, 'Date'),
    ...Object.fromEntries(stageFields.map((key) => [key, input[key] as number])) as Record<(typeof stageFields)[number], number>,
  };
}

function districtScope(userId: string, role: UserRole): Prisma.DistrictWhereInput {
  if (role === UserRole.REPUBLIC_EMPLOYEE) return { OR: [{ republicEmployeeAssignment: { is: { userId } } }, { region: { groupLeaderAssignment: { is: { userId } } } }] };
  if (role === UserRole.REGIONAL_EMPLOYEE) return { region: { employeeAssignments: { some: { userId } } } };
  return {};
}

function duplicateError(error: unknown, next: express.NextFunction) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    next(new ApiError(409, 'DUPLICATE_SNAPSHOT', 'A record already exists for this district and date'));
  } else next(error);
}

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const { regionId, districtId, from, to } = request.query;
    if ([regionId, districtId, from, to].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    const startDate = from ? parseDate(from, 'Start date') : undefined;
    const endDate = to ? parseDate(to, 'End date') : undefined;
    if (startDate && endDate && startDate > endDate) {
      throw new ApiError(400, 'INVALID_FILTER', 'The start date must not be after the end date');
    }
    const scope = districtScope(user.id, user.role);
    const districts = await prisma.district.findMany({
      where: scope,
      orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
      include: districtInclude,
    });
    const records = await prisma.overdueSnapshot.findMany({
      where: {
        district: { ...scope, ...(regionId ? { regionId: regionId as string } : {}), ...(districtId ? { id: districtId as string } : {}) },
        ...(startDate || endDate ? { recordDate: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } } : {}),
      },
      include: recordInclude,
      orderBy: [{ recordDate: 'desc' }, { district: { name: 'asc' } }],
    });
    response.json({ districts, records });
  } catch (error) { next(error); }
});

router.post('/districts/:districtId', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    if (typeof districtId !== 'string') throw new ApiError(400, 'INVALID_DISTRICT', 'A single district ID is required');
    const record = await prisma.overdueSnapshot.create({ data: { ...parsePayload(request.body), districtId }, include: recordInclude });
    response.status(201).json({ record });
  } catch (error) { duplicateError(error, next); }
});

router.patch('/districts/:districtId/records/:recordId', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    const recordId = request.params.recordId;
    if (typeof districtId !== 'string' || typeof recordId !== 'string') throw new ApiError(400, 'INVALID_RECORD', 'A single record and district ID are required');
    const record = await prisma.overdueSnapshot.findUnique({ where: { id: recordId } });
    if (!record || record.districtId !== districtId) throw new ApiError(404, 'RECORD_NOT_FOUND', 'Record not found for this district');
    const updated = await prisma.overdueSnapshot.update({ where: { id: recordId }, data: parsePayload(request.body), include: recordInclude });
    response.json({ record: updated });
  } catch (error) { duplicateError(error, next); }
});

export const overdueApplicationsRouter = router;
