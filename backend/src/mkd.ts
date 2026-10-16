import express from 'express';
import { Prisma } from '@prisma/client';
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
const firstYear = 2020;

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

// Years from 2020 up to the current Tashkent year can be chosen.
function parseYear(value: unknown): number {
  const lastYear = Number(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric' }).format(new Date()));
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < firstYear || value > lastYear) {
    throw new ApiError(400, 'INVALID_MKD_YEAR', `Year must be from ${firstYear} to ${lastYear}`);
  }
  return value;
}

function parsePayload(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_RECORD', 'A record object is required');
  }
  const input = body as Record<string, unknown>;
  const count = input.inProgressCount;
  if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0 || count > 2_147_483_647) {
    throw new ApiError(400, 'INVALID_COUNT', 'inProgressCount must be a non-negative whole number');
  }
  return { year: parseYear(input.year), recordDate: parseDate(input.recordDate), inProgressCount: count };
}

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const { regionId, districtId, year } = request.query;
    if ([regionId, districtId, year].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    const date = parseDate(request.query.date);
    const yearFilter = year ? parseYear(Number(year)) : undefined;
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
      where: { district: locationFilter, recordDate: date, ...(yearFilter ? { year: yearFilter } : {}) },
      include: recordInclude,
      orderBy: [{ district: { region: { name: 'asc' } } }, { district: { name: 'asc' } }, { year: 'asc' }],
    });
    response.json({ districts, records, writableDistrictIds: await writableDistrictIds(user, true) });
  } catch (error) { next(error); }
});

// Latest record of the year before the given date, used to prefill a new record.
router.get('/districts/:districtId/previous', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    if (typeof districtId !== 'string') throw new ApiError(400, 'INVALID_DISTRICT', 'A single district ID is required');
    if (typeof request.query.year !== 'string') throw new ApiError(400, 'INVALID_MKD_YEAR', 'A year is required');
    const record = await prisma.mkdRecord.findFirst({
      where: { districtId, year: parseYear(Number(request.query.year)), recordDate: { lt: parseDate(request.query.date) } },
      orderBy: { recordDate: 'desc' },
      select: { recordDate: true, inProgressCount: true },
    });
    response.json({ record });
  } catch (error) { next(error); }
});

router.post('/districts/:districtId', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    if (typeof districtId !== 'string') throw new ApiError(400, 'INVALID_DISTRICT', 'A single district ID is required');
    const record = await prisma.mkdRecord.create({ data: { ...parsePayload(request.body), districtId }, include: recordInclude });
    response.status(201).json({ record });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_MKD_RECORD', 'An MKD record already exists for this district, year, and date'));
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
    response.json({ record: updated });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_MKD_RECORD', 'An MKD record already exists for this district, year, and date'));
    } else next(error);
  }
});

export const mkdRouter = router;
