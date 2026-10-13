import express from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { requireAuth, requireDistrictAccess } from './auth.js';
import { prisma } from './db.js';

const router = express.Router();
const districtInclude = {
  region: true,
  republicEmployeeAssignment: { include: { user: { select: { id: true, fullName: true } } } },
  regionalEmployeeAssignment: { include: { user: { select: { id: true, fullName: true } } } },
} satisfies Prisma.DistrictInclude;
const recordInclude = { district: { include: districtInclude } } satisfies Prisma.RadLimitInclude;

function parseInteger(value: unknown, field: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new ApiError(400, 'INVALID_RAD_VALUE', `${field} must be a whole number from ${minimum} to ${maximum}`);
  }
  return value;
}

function parseQueryInteger(value: unknown, field: string, minimum: number, maximum: number): number | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d+$/.test(value)) {
    throw new ApiError(400, 'INVALID_FILTER', `${field} must be a whole number`);
  }
  return parseInteger(Number(value), field, minimum, maximum);
}

function parsePayload(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new ApiError(400, 'INVALID_RECORD', 'A record object is required');
  }
  const input = body as Record<string, unknown>;
  return {
    month: parseInteger(input.month, 'month', 1, 12),
    year: parseInteger(input.year, 'year', 1, 9999),
    monthlyLimit: parseInteger(input.monthlyLimit, 'monthlyLimit', 0, 2_147_483_647),
    rejectedApplications: parseInteger(input.rejectedApplications, 'rejectedApplications', 0, 2_147_483_647),
  };
}

function districtScope(userId: string, role: UserRole): Prisma.DistrictWhereInput {
  if (role === UserRole.REPUBLIC_EMPLOYEE) return { OR: [{ republicEmployeeAssignment: { is: { userId } } }, { region: { groupLeaderAssignment: { is: { userId } } } }] };
  if (role === UserRole.REGIONAL_EMPLOYEE) return { region: { employeeAssignments: { some: { userId } } } };
  return {};
}

function withRemaining<T extends { monthlyLimit: number; rejectedApplications: number }>(record: T) {
  return { ...record, remainingLimit: record.monthlyLimit - record.rejectedApplications };
}

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const { regionId, districtId } = request.query;
    if ([regionId, districtId].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    const month = parseQueryInteger(request.query.month, 'month', 1, 12);
    const year = parseQueryInteger(request.query.year, 'year', 1, 9999);
    const scope = districtScope(user.id, user.role);
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
    const records = await prisma.radLimit.findMany({
      where: {
        district: locationFilter,
        ...(month !== undefined ? { month } : {}),
        ...(year !== undefined ? { year } : {}),
      },
      include: recordInclude,
      orderBy: [{ year: 'desc' }, { month: 'desc' }, { district: { name: 'asc' } }],
    });
    response.json({ districts, records: records.map(withRemaining) });
  } catch (error) { next(error); }
});

router.post('/districts/:districtId', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    if (typeof districtId !== 'string') throw new ApiError(400, 'INVALID_DISTRICT', 'A single district ID is required');
    const record = await prisma.radLimit.create({ data: { ...parsePayload(request.body), districtId }, include: recordInclude });
    response.status(201).json({ record: withRemaining(record) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_RAD_LIMIT', 'A limit already exists for this district and month'));
    } else next(error);
  }
});

router.patch('/districts/:districtId/records/:recordId', requireAuth, requireDistrictAccess('write', true), async (request, response, next) => {
  try {
    const districtId = request.params.districtId;
    const recordId = request.params.recordId;
    if (typeof districtId !== 'string' || typeof recordId !== 'string') throw new ApiError(400, 'INVALID_RECORD', 'A single record and district ID are required');
    const record = await prisma.radLimit.findUnique({ where: { id: recordId } });
    if (!record || record.districtId !== districtId) throw new ApiError(404, 'RECORD_NOT_FOUND', 'RAD record not found for this district');
    const updated = await prisma.radLimit.update({ where: { id: recordId }, data: parsePayload(request.body), include: recordInclude });
    response.json({ record: withRemaining(updated) });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_RAD_LIMIT', 'A limit already exists for this district and month'));
    } else next(error);
  }
});

export const radLimitRouter = router;
