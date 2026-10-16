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
const recordInclude = { district: { include: districtInclude } } satisfies Prisma.XatlovRecordInclude;

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
  const counts = ['completedMfyCount', 'censusCount', 'completedObjectCount', 'migrationCount'] as const;
  for (const key of counts) {
    // censusCount is allowed to be negative.
    if (!Number.isSafeInteger(input[key]) || (key !== 'censusCount' && (input[key] as number) < 0)) {
      throw new ApiError(400, 'INVALID_COUNT', key === 'censusCount' ? `${key} must be a whole number` : `${key} must be a non-negative whole number`);
    }
  }
  const completedMfyNames = input.completedMfyNames;
  if (!Array.isArray(completedMfyNames) || completedMfyNames.some((name) => typeof name !== 'string' || !name.trim() || name.trim().length > 150)) {
    throw new ApiError(400, 'INVALID_MFY_NAMES', 'completedMfyNames must contain non-empty names up to 150 characters');
  }
  const paymentDebt = input.paymentDebt ?? null;
  if (paymentDebt !== null && (typeof paymentDebt !== 'number' || !Number.isFinite(paymentDebt) || paymentDebt < 0 || paymentDebt >= 1e12)) {
    throw new ApiError(400, 'INVALID_PAYMENT_DEBT', 'Payment debt must be a non-negative number');
  }
  return {
    recordDate: parseDate(input.recordDate),
    completedMfyCount: input.completedMfyCount as number,
    censusCount: input.censusCount as number,
    completedObjectCount: input.completedObjectCount as number,
    migrationCount: input.migrationCount as number,
    paymentDebt: paymentDebt === null ? null : new Prisma.Decimal(paymentDebt.toFixed(2)),
    completedMfyNames: completedMfyNames.map((name) => (name as string).trim()),
  };
}

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const regionId = request.query.regionId;
    const districtId = request.query.districtId;
    if ([regionId, districtId].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    const date = parseDate(request.query.date);
    // Weekly totals cover Monday to Friday of the selected date's week, up to the selected date.
    const weekStart = new Date(date);
    weekStart.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const friday = new Date(weekStart);
    friday.setUTCDate(weekStart.getUTCDate() + 4);
    const weekEnd = date < friday ? date : friday;
    const scope = readableDistrictScope(user);
    const authorizedDistricts: Prisma.DistrictWhereInput = { ...scope };
    const locationFilter: Prisma.DistrictWhereInput = {
      ...authorizedDistricts,
      ...(regionId ? { regionId: regionId as string } : {}),
      ...(districtId ? { id: districtId as string } : {}),
    };
    const districts = await prisma.district.findMany({
      where: authorizedDistricts,
      orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
      include: districtInclude,
    });
    const [records, weekly] = await Promise.all([
      prisma.xatlovRecord.findMany({ where: { district: locationFilter, recordDate: date }, include: recordInclude, orderBy: { district: { name: 'asc' } } }),
      prisma.xatlovRecord.groupBy({
        by: ['districtId'],
        where: { district: locationFilter, recordDate: { gte: weekStart, lte: weekEnd } },
        _sum: { censusCount: true, migrationCount: true },
        _count: { _all: true },
      }),
    ]);
    const weeklyByDistrict = new Map(weekly.map((item) => [item.districtId, { ...item._sum, days: item._count._all }]));
    response.json({
      districts,
      records: records.map((record) => ({
        ...record,
        weeklyCensusCount: weeklyByDistrict.get(record.districtId)?.censusCount ?? 0,
        weeklyMigrationCount: weeklyByDistrict.get(record.districtId)?.migrationCount ?? 0,
        // Days worked this week = days with a saved record from Monday on.
        weeklyDays: weeklyByDistrict.get(record.districtId)?.days ?? 0,
      })),
      writableDistrictIds: await writableDistrictIds(user, true),
    });
  } catch (error) { next(error); }
});

// Latest record before the given date, used to prefill a new record.
router.get('/districts/:districtId/previous', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    if (typeof districtId !== 'string') throw new ApiError(400, 'INVALID_DISTRICT', 'A single district ID is required');
    const record = await prisma.xatlovRecord.findFirst({
      where: { districtId, recordDate: { lt: parseDate(request.query.date) } },
      orderBy: { recordDate: 'desc' },
      select: { recordDate: true, completedMfyCount: true, censusCount: true, completedObjectCount: true, migrationCount: true, paymentDebt: true, completedMfyNames: true },
    });
    response.json({ record });
  } catch (error) { next(error); }
});

router.post('/districts/:districtId', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    if (typeof districtId !== 'string') throw new ApiError(400, 'INVALID_DISTRICT', 'A single district ID is required');
    const record = await prisma.xatlovRecord.create({ data: { ...parsePayload(request.body), districtId }, include: recordInclude });
    response.status(201).json({ record });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_SNAPSHOT', 'A snapshot already exists for this district and date'));
    } else next(error);
  }
});

router.patch('/districts/:districtId/records/:recordId', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const recordId = request.params.recordId;
    const districtId = request.params.districtId;
    if (typeof recordId !== 'string' || typeof districtId !== 'string') throw new ApiError(400, 'INVALID_RECORD', 'A single record and district ID are required');
    const record = await prisma.xatlovRecord.findUnique({ where: { id: recordId } });
    if (!record || record.districtId !== districtId) {
      throw new ApiError(404, 'RECORD_NOT_FOUND', 'Census record not found for this district');
    }
    const updated = await prisma.xatlovRecord.update({ where: { id: recordId }, data: parsePayload(request.body), include: recordInclude });
    response.json({ record: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_SNAPSHOT', 'A snapshot already exists for this district and date'));
    } else next(error);
  }
});

export const xatlovRouter = router;
