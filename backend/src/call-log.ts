import express from 'express';
import { CallStatus, Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { readableDistrictScope, requireAuth, requireDistrictAccess, writableDistrictIds } from './auth.js';
import { prisma } from './db.js';

const router = express.Router();
const districtInclude = {
  region: true,
  republicEmployeeAssignment: { include: { user: { select: { id: true, fullName: true } } } },
  regionalEmployeeAssignment: { include: { user: { select: { id: true, fullName: true } } } },
} satisfies Prisma.DistrictInclude;
const recordInclude = { district: { include: districtInclude } } satisfies Prisma.CallLogInclude;
const statuses = Object.values(CallStatus);

function parseDate(value: unknown, field: string): Date {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new ApiError(400, 'INVALID_DATE', `${field} must use YYYY-MM-DD format`);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new ApiError(400, 'INVALID_DATE', `Enter a valid ${field.toLowerCase()}`);
  return date;
}

function parsePayload(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError(400, 'INVALID_RECORD', 'A call record object is required');
  const input = body as Record<string, unknown>;
  if (!statuses.includes(input.status as CallStatus)) throw new ApiError(400, 'INVALID_STATUS', 'Choose a supported call status');
  if (!Array.isArray(input.monitoringAreas) || input.monitoringAreas.length > 20 || input.monitoringAreas.some((area) => typeof area !== 'string' || !area.trim() || area.trim().length > 2000)) {
    throw new ApiError(400, 'INVALID_AREAS', 'Monitoring areas discussed must be at most 2000 characters');
  }
  const optionalText = (value: unknown, field: string, max: number) => {
    if (value === null || value === undefined || value === '') return null;
    if (typeof value !== 'string' || value.trim().length > max) throw new ApiError(400, 'INVALID_FIELD', `${field} must be at most ${max} characters`);
    return value.trim();
  };
  return {
    callDate: parseDate(input.callDate, 'Call date'),
    status: input.status as CallStatus,
    monitoringAreas: [...new Set((input.monitoringAreas as string[]).map((area) => area.trim()))],
    issues: optionalText(input.issues, 'Issues', 2000),
    nextAction: optionalText(input.nextAction, 'Next action or notes', 2000),
    followUpDate: input.followUpDate === null || input.followUpDate === undefined || input.followUpDate === '' ? null : parseDate(input.followUpDate, 'Follow-up date'),
  };
}

function todayInTashkent(): Date {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`);
}

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    // Viewers do not see call logs.
    if (user.role === UserRole.VIEWER) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to view call logs');
    const dateValue = request.query.date;
    const districtId = request.query.districtId;
    if ([dateValue, districtId].some((value) => value !== undefined && typeof value !== 'string')) throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    const callDate = dateValue ? parseDate(dateValue, 'Date') : todayInTashkent();
    const scope = readableDistrictScope(user);
    const districtWhere: Prisma.DistrictWhereInput = { ...scope, ...(districtId ? { id: districtId as string } : {}) };
    const [districts, records] = await Promise.all([
      prisma.district.findMany({ where: districtWhere, orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }], include: districtInclude }),
      prisma.callLog.findMany({ where: { callDate, district: districtWhere }, include: recordInclude, orderBy: [{ district: { name: 'asc' } }] }),
    ]);
    const recordedDistrictIds = new Set(records.map((record) => record.districtId));
    const recordByDistrict = new Map(records.map((record) => [record.districtId, record]));
    const needsAttention = districts.filter((district) => {
      const record = recordByDistrict.get(district.id);
      return !record || record.status === CallStatus.CALLBACK_REQUIRED;
    });
    response.json({ callDate: callDate.toISOString().slice(0, 10), districts, records, needsAttention, writableDistrictIds: await writableDistrictIds(user), notContactedCount: districts.length - recordedDistrictIds.size });
  } catch (error) { next(error); }
});

router.post('/districts/:districtId', requireAuth, requireDistrictAccess('write'), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    if (typeof districtId !== 'string') throw new ApiError(400, 'INVALID_DISTRICT', 'A single district ID is required');
    const record = await prisma.callLog.create({ data: { ...parsePayload(request.body), districtId }, include: recordInclude });
    response.status(201).json({ record });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return next(new ApiError(409, 'DUPLICATE_CALL', 'A call record already exists for this district and date'));
    next(error);
  }
});

router.patch('/districts/:districtId/records/:recordId', requireAuth, requireDistrictAccess('write'), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    const recordId = request.params.recordId;
    if (typeof districtId !== 'string' || typeof recordId !== 'string') throw new ApiError(400, 'INVALID_RECORD', 'A single record and district ID are required');
    const existing = await prisma.callLog.findUnique({ where: { id: recordId } });
    if (!existing || existing.districtId !== districtId) throw new ApiError(404, 'RECORD_NOT_FOUND', 'Call record not found for this district');
    const record = await prisma.callLog.update({ where: { id: recordId }, data: parsePayload(request.body), include: recordInclude });
    response.json({ record });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return next(new ApiError(409, 'DUPLICATE_CALL', 'A call record already exists for this district and date'));
    next(error);
  }
});

export const callLogRouter = router;
