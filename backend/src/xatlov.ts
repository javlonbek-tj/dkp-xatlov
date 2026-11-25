import express from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error.js';
import { readableDistrictScope, requireAuth, requireDistrictAccess, writableDistrictIds } from './auth.js';
import { tashkentToday } from './dashboard.js';
import { prisma } from './db.js';
import { normalizeName } from './etirof.js';
import { lastWorkDaysStart, xatlovPlan } from './xatlov-plan.js';

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
    // Weekly totals cover Monday to Sunday of the selected date's week, up to the selected date.
    const weekStart = new Date(date);
    weekStart.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const weekEnd = date;
    // Working days are Monday to Friday; weekend work raises the total but is not counted as a working day.
    const workDays = Math.min(((date.getUTCDay() + 6) % 7) + 1, 5);
    // The finish-date forecast uses the pace of the last 5 working days up to the selected date.
    const paceStart = lastWorkDaysStart(date, 5);
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
    const [records, weekly, pace] = await Promise.all([
      prisma.xatlovRecord.findMany({ where: { district: locationFilter, recordDate: date }, include: recordInclude, orderBy: { district: { name: 'asc' } } }),
      prisma.xatlovRecord.findMany({
        where: { district: locationFilter, recordDate: { gte: weekStart, lte: weekEnd } },
        select: { districtId: true, recordDate: true, censusCount: true, migrationCount: true },
      }),
      prisma.xatlovRecord.groupBy({
        by: ['districtId'],
        where: { district: locationFilter, recordDate: { gte: paceStart, lte: date } },
        _sum: { migrationCount: true },
        _count: { _all: true },
      }),
    ]);
    const weekOf = (districtId: string) => weekly.filter((item) => item.districtId === districtId);
    const paceByDistrict = new Map(pace.map((item) => [item.districtId, { migrationCount: item._sum.migrationCount ?? 0, days: item._count._all }]));
    response.json({
      districts,
      records: records.map((record) => ({
        ...record,
        weeklyCensusCount: weekOf(record.districtId).reduce((sum, item) => sum + item.censusCount, 0),
        weeklyMigrationCount: weekOf(record.districtId).reduce((sum, item) => sum + item.migrationCount, 0),
        // Working days (Monday to Friday) of the week up to the selected date.
        weeklyDays: workDays,
        // Census and migration on each day of the week, Monday first; null for a day without a record.
        weekByDay: Array.from({ length: 7 }, (_, day) => {
          const item = weekOf(record.districtId).find((entry) => (entry.recordDate.getUTCDay() + 6) % 7 === day);
          return item ? { censusCount: item.censusCount, migrationCount: item.migrationCount } : null;
        }),
        // Migration and days with a record in the last 5 working days.
        paceMigrationCount: paceByDistrict.get(record.districtId)?.migrationCount ?? 0,
        paceDays: paceByDistrict.get(record.districtId)?.days ?? 0,
      })),
      writableDistrictIds: await writableDistrictIds(user, true),
      // Working days left after the selected date, for the daily plan of each district.
      plan: xatlovPlan(date),
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

// Saves one day of district results from the Xatlov Excel file. Access is the same as for manual entry:
// administrators any district, Republic employees their own districts. A saved record of that day is updated
// (its MFY names are kept), otherwise a new one is created. Nothing is saved when a row is invalid.
router.post('/import', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const input = (request.body ?? {}) as Record<string, unknown>;
    const recordDate = parseDate(input.recordDate);
    if (recordDate > tashkentToday().date) throw new ApiError(400, 'INVALID_DATE', 'Kelajakdagi sana uchun ma’lumot kiritib bo‘lmaydi');
    const writable = await writableDistrictIds(user, true);
    if (writable?.length === 0) throw new ApiError(403, 'FORBIDDEN', 'Sizda Xatlov ma’lumotlarini kiritish huquqi yo‘q');
    const regionName = typeof input.region === 'string' ? normalizeName(input.region) : '';
    const region = (await prisma.region.findMany({ select: { id: true, name: true } })).find((item) => regionName.includes(normalizeName(item.name)));
    if (!region) throw new ApiError(400, 'INVALID_REGION', 'Fayldagi jami qatoridan viloyat aniqlanmadi');
    const rows = input.rows;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100) throw new ApiError(400, 'INVALID_ROWS', 'Faylda tumanlar ro‘yxati topilmadi');

    const districts = await prisma.district.findMany({ where: { regionId: region.id }, select: { id: true, name: true } });
    const byName = new Map(districts.map((item) => [normalizeName(item.name), item]));
    const errors: string[] = [];
    const seen = new Set<string>();
    const data: { districtId: string; values: Omit<Prisma.XatlovRecordUncheckedCreateInput, 'districtId' | 'recordDate'> }[] = [];
    rows.forEach((row, index) => {
      const values = (row ?? {}) as Record<string, unknown>;
      const line = `${typeof values.line === 'number' ? values.line : index + 1}-qator`;
      const district = typeof values.district === 'string' ? byName.get(normalizeName(values.district)) : undefined;
      if (!district) { errors.push(`${line}: "${String(values.district ?? '')}" tumani ${region.name}da topilmadi`); return; }
      if (writable && !writable.includes(district.id)) { errors.push(`${line}: ${district.name} sizga biriktirilmagan`); return; }
      if (seen.has(district.id)) { errors.push(`${line}: ${district.name} takrorlangan`); return; }
      seen.add(district.id);
      const counts = ['completedMfyCount', 'censusCount', 'completedObjectCount', 'migrationCount'] as const;
      // censusCount is allowed to be negative, as in the manual form.
      const bad = counts.filter((key) => !Number.isSafeInteger(values[key]) || (key !== 'censusCount' && (values[key] as number) < 0));
      const debt = values.paymentDebt ?? null;
      if (bad.length) errors.push(`${line}: ${district.name} — raqamlar butun son bo‘lishi kerak`);
      else if (debt !== null && (typeof debt !== 'number' || !Number.isFinite(debt) || debt < 0 || debt >= 1e12)) errors.push(`${line}: ${district.name} — to‘lov summasi noto‘g‘ri`);
      else data.push({
        districtId: district.id,
        values: {
          completedMfyCount: values.completedMfyCount as number,
          censusCount: values.censusCount as number,
          completedObjectCount: values.completedObjectCount as number,
          migrationCount: values.migrationCount as number,
          paymentDebt: debt === null ? null : new Prisma.Decimal((debt as number).toFixed(2)),
        },
      });
    });
    if (errors.length) throw new ApiError(400, 'INVALID_ROWS', `Fayldagi xatolar (${errors.length} ta): ${errors.slice(0, 10).join('; ')}${errors.length > 10 ? '; …' : ''}`);

    const existing = await prisma.xatlovRecord.count({ where: { recordDate, districtId: { in: data.map((item) => item.districtId) } } });
    await prisma.$transaction(data.map((item) => prisma.xatlovRecord.upsert({
      where: { districtId_recordDate: { districtId: item.districtId, recordDate } },
      create: { districtId: item.districtId, recordDate, ...item.values },
      update: item.values,
    })));
    response.json({ saved: data.length, updated: existing, created: data.length - existing });
  } catch (error) { next(error); }
});

export const xatlovRouter = router;
