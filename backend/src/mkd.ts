import express from 'express';
import { MkdType, Prisma } from '@prisma/client';
import { ApiError } from './api-error.js';
import { readableDistrictScope, requireAuth, requireDistrictAccess, writableDistrictIds } from './auth.js';
import { prisma } from './db.js';

const router = express.Router();
const districtInclude = {
  region: true,
  republicEmployeeAssignment: { include: { user: { select: { id: true, fullName: true } } } },
  regionalEmployeeAssignment: { include: { user: { select: { id: true, fullName: true } } } },
} satisfies Prisma.DistrictInclude;
const recordInclude = { district: { include: districtInclude } } satisfies Prisma.MkdRecordInclude;

function parseDate(value: unknown): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, 'INVALID_DATE', 'Date must use YYYY-MM-DD format');
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, 'INVALID_DATE', 'Enter a valid date');
  }
  return date;
}

function parsePayload(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_RECORD', 'A record object is required');
  }
  const input = body as Record<string, unknown>;
  if (!Object.values(MkdType).includes(input.type as MkdType)) {
    throw new ApiError(400, 'INVALID_MKD_TYPE', 'Choose a supported MKD type');
  }
  const keys = ['totalBuildings', 'completedBuildings', 'plannedBuildings', 'completedAgainstPlan'] as const;
  for (const key of keys) {
    if (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0) {
      throw new ApiError(400, 'INVALID_COUNT', `${key} must be a non-negative whole number`);
    }
  }
  const total = input.totalBuildings as number;
  const completed = input.completedBuildings as number;
  const planned = input.plannedBuildings as number;
  const completedPlan = input.completedAgainstPlan as number;
  if (completed > total || planned > total || completedPlan > planned || completedPlan > completed) {
    throw new ApiError(400, 'IMPOSSIBLE_COUNTS', 'Completed values cannot exceed their total or planned values');
  }
  return {
    type: input.type as MkdType,
    targetDate: parseDate(input.targetDate),
    totalBuildings: total,
    completedBuildings: completed,
    plannedBuildings: planned,
    completedAgainstPlan: completedPlan,
  };
}

function withRemaining<T extends { totalBuildings: number; completedBuildings: number; plannedBuildings: number; completedAgainstPlan: number }>(record: T) {
  return {
    ...record,
    remainingBuildings: record.totalBuildings - record.completedBuildings,
    remainingPlan: record.plannedBuildings - record.completedAgainstPlan,
  };
}

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const { regionId, districtId, type, from, to } = request.query;
    if ([regionId, districtId, type, from, to].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    if (type !== undefined && !Object.values(MkdType).includes(type as MkdType)) {
      throw new ApiError(400, 'INVALID_MKD_TYPE', 'Choose a supported MKD type');
    }
    const startDate = from ? parseDate(from) : undefined;
    const endDate = to ? parseDate(to) : undefined;
    if (startDate && endDate && startDate > endDate) {
      throw new ApiError(400, 'INVALID_FILTER', 'The start date must not be after the end date');
    }
    const scope = readableDistrictScope(user);
    const locationFilter: Prisma.DistrictWhereInput = {
      ...scope,
      ...(regionId ? { regionId: regionId as string } : {}),
      ...(districtId ? { id: districtId as string } : {}),
    };
    const districts = await prisma.district.findMany({
      where: scope,
      orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
      include: districtInclude,
    });
    const records = await prisma.mkdRecord.findMany({
      where: {
        district: locationFilter,
        ...(type ? { type: type as MkdType } : {}),
        ...(startDate || endDate ? { targetDate: { ...(startDate ? { gte: startDate } : {}), ...(endDate ? { lte: endDate } : {}) } } : {}),
      },
      include: recordInclude,
      orderBy: [{ targetDate: 'desc' }, { district: { name: 'asc' } }, { type: 'asc' }],
    });
    response.json({ districts, records: records.map(withRemaining), writableDistrictIds: await writableDistrictIds(user, true) });
  } catch (error) { next(error); }
});

router.post('/districts/:districtId', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    if (typeof districtId !== 'string') throw new ApiError(400, 'INVALID_DISTRICT', 'A single district ID is required');
    const record = await prisma.mkdRecord.create({ data: { ...parsePayload(request.body), districtId }, include: recordInclude });
    response.status(201).json({ record: withRemaining(record) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_MKD_PLAN', 'A record already exists for this district, type, and target date'));
    } else next(error);
  }
});

router.patch('/districts/:districtId/records/:recordId', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    const recordId = request.params.recordId;
    if (typeof districtId !== 'string' || typeof recordId !== 'string') throw new ApiError(400, 'INVALID_RECORD', 'A single record and district ID are required');
    const record = await prisma.mkdRecord.findUnique({ where: { id: recordId } });
    if (!record || record.districtId !== districtId) throw new ApiError(404, 'RECORD_NOT_FOUND', 'MKD record not found for this district');
    const updated = await prisma.mkdRecord.update({ where: { id: recordId }, data: parsePayload(request.body), include: recordInclude });
    response.json({ record: withRemaining(updated) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_MKD_PLAN', 'A record already exists for this district, type, and target date'));
    } else next(error);
  }
});

export const mkdRouter = router;
