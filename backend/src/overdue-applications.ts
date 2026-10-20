import express from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error.js';
import { readableDistrictScope, requireAuth, requireDistrictAccess, writableDistrictIds } from './auth.js';
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

function duplicateError(error: unknown, next: express.NextFunction) {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    next(new ApiError(409, 'DUPLICATE_SNAPSHOT', 'A record already exists for this district and date'));
  } else next(error);
}

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const { regionId, districtId } = request.query;
    if ([regionId, districtId].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    const date = parseDate(request.query.date, 'Date');
    const scope = readableDistrictScope(user);
    const districts = await prisma.district.findMany({
      where: scope,
      orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
      include: districtInclude,
    });
    const records = await prisma.overdueSnapshot.findMany({
      where: {
        district: { ...scope, ...(regionId ? { regionId: regionId as string } : {}), ...(districtId ? { id: districtId as string } : {}) },
        recordDate: date,
      },
      include: recordInclude,
      orderBy: [{ recordDate: 'desc' }, { district: { name: 'asc' } }],
    });
    response.json({ districts, records, writableDistrictIds: await writableDistrictIds(user, true) });
  } catch (error) { next(error); }
});

// Adds an all-zero record for the date to every editable district without one; existing records are never changed.
router.post('/fill-zero', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const input = (request.body ?? {}) as Record<string, unknown>;
    const { regionId, districtId } = input;
    if ([regionId, districtId].some((value) => value !== undefined && value !== null && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    const recordDate = parseDate(input.recordDate, 'Date');
    const writable = await writableDistrictIds(user, true);
    if (writable && !writable.length) throw new ApiError(403, 'FORBIDDEN', 'You cannot add overdue application records');
    const districts = await prisma.district.findMany({
      where: {
        AND: [
          readableDistrictScope(user),
          regionId ? { regionId: regionId as string } : {},
          districtId ? { id: districtId as string } : {},
          writable ? { id: { in: writable } } : {},
        ],
        overdueSnapshots: { none: { recordDate } },
      },
      select: { id: true },
    });
    // Every stage count defaults to 0.
    const result = await prisma.overdueSnapshot.createMany({
      data: districts.map((district) => ({ districtId: district.id, recordDate })),
      skipDuplicates: true,
    });
    response.status(201).json({ created: result.count });
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
