import express, { type NextFunction, type Request } from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { readableDistrictScope, requireAuth } from './auth.js';
import { prisma } from './db.js';
import { hashPassword } from './password.js';

const router = express.Router();
router.use(requireAuth);
const userSelect = { id: true, username: true, fullName: true, phone: true } satisfies Prisma.UserSelect;

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

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new ApiError(400, 'INVALID_INPUT', `${field} is required and must be at most ${maxLength} characters`);
  }
  return value.trim();
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  return text(value, field, maxLength);
}

function optionalPhone(value: unknown): string | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string' || !/^\+?[\d\s()-]{5,30}$/.test(value.trim())) {
    throw new ApiError(400, 'INVALID_PHONE', 'Phone number may contain only digits, spaces, brackets, dashes and a leading +');
  }
  return value.trim();
}

function password(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new ApiError(400, 'INVALID_INPUT', 'Password is required and must be at most 200 characters');
  }
  return value;
}

function parseWork(body: unknown) {
  const input = (body ?? {}) as Record<string, unknown>;
  for (const key of ['censusCount', 'migrationCount'] as const) {
    if (!Number.isSafeInteger(input[key]) || (input[key] as number) < 0) {
      throw new ApiError(400, 'INVALID_COUNT', `${key} must be a non-negative whole number`);
    }
  }
  return { recordDate: parseDate(input.recordDate), censusCount: input.censusCount as number, migrationCount: input.migrationCount as number };
}

// District heads see only their own district; everyone else sees the districts of their regions.
function districtScope(user: { id: string; role: UserRole }): Prisma.DistrictWhereInput {
  return user.role === UserRole.DISTRICT_HEAD ? { heads: { some: { id: user.id } } } : readableDistrictScope(user);
}

// Administrators and Republic employees assigned to the district's region keep the staff list, district heads and records.
const canManage = (user: { role: UserRole }) => user.role === UserRole.ADMIN || user.role === UserRole.REPUBLIC_EMPLOYEE;

async function requireDistrict(request: Request, access: 'manage' | 'enter') {
  const user = request.auth!;
  const permitted = canManage(user) || (access === 'enter' && user.role === UserRole.DISTRICT_HEAD);
  const districtId = request.params.districtId as string;
  if (!permitted || (await prisma.district.count({ where: { id: districtId, ...districtScope(user) } })) === 0) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this district');
  }
  return districtId;
}

async function requireEmployee(districtId: string, employeeId: string) {
  const employee = await prisma.districtEmployee.findUnique({ where: { id: employeeId }, select: { districtId: true } });
  if (!employee || employee.districtId !== districtId) throw new ApiError(404, 'EMPLOYEE_NOT_FOUND', 'Employee not found in this district');
}

async function requireHead(districtId: string, userId: string) {
  const head = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, districtId: true } });
  if (!head || head.role !== UserRole.DISTRICT_HEAD || head.districtId !== districtId) {
    throw new ApiError(404, 'USER_NOT_FOUND', 'District head not found in this district');
  }
}

function mapDatabaseError(error: unknown, next: NextFunction): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_RECORD', 'A record with these details already exists'));
      return;
    }
    if (error.code === 'P2003') {
      next(new ApiError(409, 'RECORD_IN_USE', 'This employee already has daily work records'));
      return;
    }
  }
  next(error);
}

// Employees in scope with their work on the given date and their Monday–Friday totals for that week.
router.get('/', async (request, response, next) => {
  try {
    const user = request.auth!;
    const regionId = request.query.regionId;
    const districtId = request.query.districtId;
    if ([regionId, districtId].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    const date = parseDate(request.query.date);
    // Weekly totals cover Monday to Friday of the selected date's week, up to the selected date, as on the district tab.
    const weekStart = new Date(date);
    weekStart.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const friday = new Date(weekStart);
    friday.setUTCDate(weekStart.getUTCDate() + 4);
    const weekEnd = date < friday ? date : friday;
    const scope = districtScope(user);
    const locationFilter: Prisma.DistrictWhereInput = {
      ...scope,
      ...(regionId ? { regionId: regionId as string } : {}),
      ...(districtId ? { id: districtId as string } : {}),
    };
    const [districts, employees] = await Promise.all([
      prisma.district.findMany({
        where: scope,
        orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
        select: {
          id: true, name: true, regionId: true, region: { select: { id: true, name: true } },
          ...(canManage(user) ? { heads: { where: { role: UserRole.DISTRICT_HEAD }, select: userSelect, orderBy: { fullName: 'asc' as const } } } : {}),
        },
      }),
      prisma.districtEmployee.findMany({
        where: { district: locationFilter },
        orderBy: [{ district: { region: { name: 'asc' } } }, { district: { name: 'asc' } }, { fullName: 'asc' }],
        include: {
          district: { select: { id: true, name: true, region: { select: { id: true, name: true } } } },
          dailyWork: { where: { recordDate: { gte: weekStart, lte: date } } },
        },
      }),
    ]);
    response.json({
      districts,
      employees: employees.map(({ dailyWork, ...employee }) => {
        const week = dailyWork.filter((work) => work.recordDate <= weekEnd);
        return {
          ...employee,
          record: dailyWork.find((work) => work.recordDate.getTime() === date.getTime()) ?? null,
          weeklyCensusCount: week.reduce((sum, work) => sum + work.censusCount, 0),
          weeklyMigrationCount: week.reduce((sum, work) => sum + work.migrationCount, 0),
        };
      }),
      canManage: canManage(user),
    });
  } catch (error) { next(error); }
});

router.post('/districts/:districtId/employees', async (request, response, next) => {
  try {
    const districtId = await requireDistrict(request, 'manage');
    const employee = await prisma.districtEmployee.create({
      data: {
        districtId,
        fullName: text(request.body?.fullName, 'Full name', 150),
        position: optionalText(request.body?.position, 'Position', 150),
        phone: optionalPhone(request.body?.phone),
        note: optionalText(request.body?.note, 'Note', 300),
      },
    });
    response.status(201).json({ employee });
  } catch (error) { mapDatabaseError(error, next); }
});

router.patch('/districts/:districtId/employees/:employeeId', async (request, response, next) => {
  try {
    const districtId = await requireDistrict(request, 'manage');
    const employeeId = request.params.employeeId as string;
    await requireEmployee(districtId, employeeId);
    const employee = await prisma.districtEmployee.update({
      where: { id: employeeId },
      data: {
        fullName: text(request.body?.fullName, 'Full name', 150),
        position: optionalText(request.body?.position, 'Position', 150),
        phone: optionalPhone(request.body?.phone),
        note: optionalText(request.body?.note, 'Note', 300),
      },
    });
    response.json({ employee });
  } catch (error) { mapDatabaseError(error, next); }
});

// Employees with saved daily work cannot be deleted, so their history is preserved.
router.delete('/districts/:districtId/employees/:employeeId', async (request, response, next) => {
  try {
    const districtId = await requireDistrict(request, 'manage');
    const employeeId = request.params.employeeId as string;
    await requireEmployee(districtId, employeeId);
    await prisma.districtEmployee.delete({ where: { id: employeeId } });
    response.status(204).end();
  } catch (error) { mapDatabaseError(error, next); }
});

// District heads may only add a record; changing a saved record is left to Administrators and Republic employees.
router.post('/districts/:districtId/employees/:employeeId/records', async (request, response, next) => {
  try {
    const districtId = await requireDistrict(request, 'enter');
    const employeeId = request.params.employeeId as string;
    await requireEmployee(districtId, employeeId);
    const record = await prisma.employeeDailyWork.create({ data: { ...parseWork(request.body), employeeId } });
    response.status(201).json({ record });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_RECORD', 'A record already exists for this employee and date'));
    } else next(error);
  }
});

router.patch('/districts/:districtId/employees/:employeeId/records/:recordId', async (request, response, next) => {
  try {
    const districtId = await requireDistrict(request, 'manage');
    const employeeId = request.params.employeeId as string;
    await requireEmployee(districtId, employeeId);
    const existing = await prisma.employeeDailyWork.findUnique({ where: { id: request.params.recordId as string }, select: { id: true, employeeId: true } });
    if (!existing || existing.employeeId !== employeeId) throw new ApiError(404, 'RECORD_NOT_FOUND', 'Daily work record not found for this employee');
    const record = await prisma.employeeDailyWork.update({ where: { id: existing.id }, data: parseWork(request.body) });
    response.json({ record });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_RECORD', 'A record already exists for this employee and date'));
    } else next(error);
  }
});

// District head accounts are created and managed by Administrators and the Republic employees of the region.
router.post('/districts/:districtId/heads', async (request, response, next) => {
  try {
    const districtId = await requireDistrict(request, 'manage');
    const user = await prisma.user.create({
      data: {
        username: text(request.body?.username, 'Username', 100).toLowerCase(),
        fullName: text(request.body?.fullName, 'Full name', 150),
        phone: optionalPhone(request.body?.phone),
        passwordHash: await hashPassword(password(request.body?.password)),
        role: UserRole.DISTRICT_HEAD,
        districtId,
      },
      select: userSelect,
    });
    response.status(201).json({ user });
  } catch (error) { mapDatabaseError(error, next); }
});

router.patch('/districts/:districtId/heads/:userId', async (request, response, next) => {
  try {
    const districtId = await requireDistrict(request, 'manage');
    const userId = request.params.userId as string;
    await requireHead(districtId, userId);
    const data: { fullName: string; phone: string | null; passwordHash?: string } = {
      fullName: text(request.body?.fullName, 'Full name', 150),
      phone: optionalPhone(request.body?.phone),
    };
    if (request.body?.password !== undefined) data.passwordHash = await hashPassword(password(request.body.password));
    const user = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({ where: { id: userId }, data, select: userSelect });
      if (data.passwordHash) await transaction.session.deleteMany({ where: { userId } });
      return updated;
    });
    response.json({ user });
  } catch (error) { mapDatabaseError(error, next); }
});

router.delete('/districts/:districtId/heads/:userId', async (request, response, next) => {
  try {
    const districtId = await requireDistrict(request, 'manage');
    const userId = request.params.userId as string;
    await requireHead(districtId, userId);
    await prisma.user.delete({ where: { id: userId } });
    response.status(204).end();
  } catch (error) { mapDatabaseError(error, next); }
});

export const districtEmployeesRouter = router;
