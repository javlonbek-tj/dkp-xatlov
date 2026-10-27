import express, { type NextFunction, type Request } from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { reportDistrictScope, requireAuth, requireRole } from './auth.js';
import { tashkentToday } from './dashboard.js';
import { prisma } from './db.js';
import { hashPassword } from './password.js';

const router = express.Router();
router.use(requireAuth);
const adminOnly = requireRole(UserRole.ADMIN);
const specialistSelect = {
  id: true, username: true, fullName: true, phone: true, position: true,
  district: { select: { id: true, name: true, regionId: true, region: { select: { id: true, name: true } } } },
} satisfies Prisma.UserSelect;

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

// A payment may be entered for today or an earlier day, never for the future.
function parsePayment(body: unknown) {
  const input = (body ?? {}) as Record<string, unknown>;
  const recordDate = parseDate(input.recordDate);
  if (recordDate > tashkentToday().date) throw new ApiError(400, 'INVALID_DATE', 'A payment cannot be entered for a future date');
  const amount = input.amount;
  if (typeof amount !== 'number' || !Number.isFinite(amount) || amount <= 0 || amount >= 1e11) {
    throw new ApiError(400, 'INVALID_AMOUNT', 'Amount must be a positive number');
  }
  return {
    recordDate,
    applicationNumber: text(input.applicationNumber, 'Application number', 50),
    amount: new Prisma.Decimal(amount.toFixed(3)),
  };
}

// The same application number entered again is refused unless the user confirms it (e.g. a payment in instalments).
async function checkDuplicate(body: unknown, applicationNumber: string, exceptId?: string) {
  if ((body as Record<string, unknown> | undefined)?.allowDuplicate === true) return;
  const existing = await prisma.paymentRecord.findFirst({
    where: { applicationNumber, ...(exceptId ? { id: { not: exceptId } } : {}) },
    select: { recordDate: true, user: { select: { fullName: true } } },
  });
  if (existing) {
    throw new ApiError(409, 'DUPLICATE_APPLICATION', `Bu ariza raqami ${existing.recordDate.toISOString().slice(0, 10).split('-').reverse().join('.')} kuni ${existing.user.fullName} tomonidan kiritilgan`);
  }
}

// Specialists change only the records they entered today; administrators change any record.
async function requireEditableRecord(request: Request) {
  const user = request.auth!;
  const record = await prisma.paymentRecord.findUnique({ where: { id: request.params.recordId as string } });
  if (!record || (user.role !== UserRole.ADMIN && record.userId !== user.id)) {
    throw new ApiError(404, 'RECORD_NOT_FOUND', 'Payment record not found');
  }
  if (user.role !== UserRole.ADMIN && record.createdAt < tashkentStartOfToday()) {
    throw new ApiError(403, 'RECORD_LOCKED', 'Only records entered today can be changed');
  }
  return record;
}

// Midnight in Tashkent (UTC+5) as a moment in time.
function tashkentStartOfToday() {
  return new Date(tashkentToday().date.getTime() - 5 * 3_600_000);
}

function mapDatabaseError(error: unknown, next: NextFunction): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_USERNAME', 'This login is already taken'));
      return;
    }
    if (error.code === 'P2003') {
      next(new ApiError(409, 'RECORD_IN_USE', 'This specialist already has payment records'));
      return;
    }
  }
  next(error);
}

// Monday of the date's week up to the date or Friday, whichever is earlier, as on the Xatlov page; and the month up to the date.
function periods(date: Date) {
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const friday = new Date(weekStart);
  friday.setUTCDate(weekStart.getUTCDate() + 4);
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return { weekStart, weekEnd: date < friday ? date : friday, monthStart };
}

type Totals = { count: number; amount: number };
const emptyTotals = (): { daily: Totals; weekly: Totals; monthly: Totals } => ({ daily: { count: 0, amount: 0 }, weekly: { count: 0, amount: 0 }, monthly: { count: 0, amount: 0 } });

// Daily, weekly (Mon–Fri) and monthly payment counts and sums per key, from the records of the month up to the date.
function summarize<T extends { recordDate: Date; amount: Prisma.Decimal }>(records: T[], date: Date, key: (record: T) => string) {
  const { weekStart, weekEnd } = periods(date);
  const totals = new Map<string, ReturnType<typeof emptyTotals>>();
  for (const record of records) {
    const item = totals.get(key(record)) ?? emptyTotals();
    const amount = record.amount.toNumber();
    const add = (target: Totals) => { target.count += 1; target.amount += amount; };
    add(item.monthly);
    if (record.recordDate >= weekStart && record.recordDate <= weekEnd) add(item.weekly);
    if (record.recordDate.getTime() === date.getTime()) add(item.daily);
    totals.set(key(record), item);
  }
  return totals;
}

// ---- Specialist's own entries ----

router.get('/mine', requireRole(UserRole.PAYMENT_SPECIALIST), async (request, response, next) => {
  try {
    const user = request.auth!;
    const date = parseDate(request.query.date);
    const { monthStart } = periods(date);
    const [specialist, records] = await Promise.all([
      prisma.user.findUnique({ where: { id: user.id }, select: specialistSelect }),
      prisma.paymentRecord.findMany({ where: { userId: user.id, recordDate: { gte: monthStart, lte: date } }, orderBy: { createdAt: 'asc' } }),
    ]);
    response.json({
      specialist,
      records: records.filter((record) => record.recordDate.getTime() === date.getTime()),
      totals: summarize(records, date, () => user.id).get(user.id) ?? emptyTotals(),
      editableFrom: tashkentStartOfToday(),
    });
  } catch (error) { next(error); }
});

router.post('/records', requireRole(UserRole.PAYMENT_SPECIALIST), async (request, response, next) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: request.auth!.id }, select: { id: true, districtId: true } });
    if (!user?.districtId) throw new ApiError(400, 'NO_DISTRICT', 'The specialist is not linked to a district');
    const payment = parsePayment(request.body);
    await checkDuplicate(request.body, payment.applicationNumber);
    const record = await prisma.paymentRecord.create({ data: { ...payment, userId: user.id, districtId: user.districtId } });
    response.status(201).json({ record });
  } catch (error) { next(error); }
});

router.patch('/records/:recordId', requireRole(UserRole.PAYMENT_SPECIALIST, UserRole.ADMIN), async (request, response, next) => {
  try {
    const existing = await requireEditableRecord(request);
    const payment = parsePayment(request.body);
    await checkDuplicate(request.body, payment.applicationNumber, existing.id);
    const record = await prisma.paymentRecord.update({ where: { id: existing.id }, data: payment });
    response.json({ record });
  } catch (error) { next(error); }
});

router.delete('/records/:recordId', requireRole(UserRole.PAYMENT_SPECIALIST, UserRole.ADMIN), async (request, response, next) => {
  try {
    const existing = await requireEditableRecord(request);
    await prisma.paymentRecord.delete({ where: { id: existing.id } });
    response.status(204).end();
  } catch (error) { next(error); }
});

// ---- Analysis for everyone else, in the same district scope as the report ----

const readers = requireRole(UserRole.ADMIN, UserRole.REPUBLIC_EMPLOYEE, UserRole.REGIONAL_EMPLOYEE, UserRole.VIEWER, UserRole.DISTRICT_HEAD);

router.get('/', readers, async (request, response, next) => {
  try {
    const user = request.auth!;
    const regionId = request.query.regionId;
    const districtId = request.query.districtId;
    if ([regionId, districtId].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    const date = parseDate(request.query.date);
    const { monthStart } = periods(date);
    const scope = reportDistrictScope(user);
    const locationFilter: Prisma.DistrictWhereInput = {
      ...scope,
      ...(regionId ? { regionId: regionId as string } : {}),
      ...(districtId ? { id: districtId as string } : {}),
    };
    const [districts, specialists, records] = await Promise.all([
      prisma.district.findMany({
        where: scope,
        orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
        select: { id: true, name: true, regionId: true, region: { select: { id: true, name: true } } },
      }),
      prisma.user.findMany({
        where: { role: UserRole.PAYMENT_SPECIALIST, district: locationFilter },
        orderBy: [{ district: { region: { name: 'asc' } } }, { district: { name: 'asc' } }, { fullName: 'asc' }],
        select: specialistSelect,
      }),
      prisma.paymentRecord.findMany({
        where: { district: locationFilter, recordDate: { gte: monthStart, lte: date } },
        select: { userId: true, districtId: true, recordDate: true, amount: true },
      }),
    ]);
    const bySpecialist = summarize(records, date, (record) => record.userId);
    const byDistrict = summarize(records, date, (record) => record.districtId);
    const specialistCount = new Map<string, number>();
    for (const specialist of specialists) if (specialist.district) specialistCount.set(specialist.district.id, (specialistCount.get(specialist.district.id) ?? 0) + 1);
    response.json({
      districts,
      specialists: specialists.map((specialist) => ({ ...specialist, ...(bySpecialist.get(specialist.id) ?? emptyTotals()) })),
      // Districts that have specialists or payments.
      districtTotals: districts
        .filter((district) => (!regionId || district.regionId === regionId) && (!districtId || district.id === districtId))
        .filter((district) => specialistCount.has(district.id) || byDistrict.has(district.id))
        .map((district) => ({ ...district, specialistCount: specialistCount.get(district.id) ?? 0, ...(byDistrict.get(district.id) ?? emptyTotals()) })),
      canEdit: user.role === UserRole.ADMIN,
    });
  } catch (error) { next(error); }
});

// One specialist's payments on a date, for the details window of the analysis table.
router.get('/specialists/:userId/records', readers, async (request, response, next) => {
  try {
    const date = parseDate(request.query.date);
    const specialist = await prisma.user.findFirst({
      where: { id: request.params.userId as string, role: UserRole.PAYMENT_SPECIALIST, district: reportDistrictScope(request.auth!) },
      select: { id: true },
    });
    if (!specialist) throw new ApiError(404, 'USER_NOT_FOUND', 'Payment specialist not found');
    const records = await prisma.paymentRecord.findMany({ where: { userId: specialist.id, recordDate: date }, orderBy: { createdAt: 'asc' } });
    response.json({ records });
  } catch (error) { next(error); }
});

// ---- Specialist accounts, kept by administrators ----

function specialistData(body: unknown) {
  const input = (body ?? {}) as Record<string, unknown>;
  return {
    fullName: text(input.fullName, 'Full name', 150),
    phone: optionalPhone(input.phone),
    position: optionalText(input.position, 'Position', 150),
    districtId: text(input.districtId, 'District', 100),
  };
}

async function requireSpecialist(userId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user || user.role !== UserRole.PAYMENT_SPECIALIST) throw new ApiError(404, 'USER_NOT_FOUND', 'Payment specialist not found');
}

async function requireDistrictExists(districtId: string) {
  if ((await prisma.district.count({ where: { id: districtId } })) === 0) throw new ApiError(400, 'INVALID_DISTRICT', 'Choose an existing district');
}

router.get('/specialists', adminOnly, async (_request, response, next) => {
  try {
    const specialists = await prisma.user.findMany({
      where: { role: UserRole.PAYMENT_SPECIALIST },
      orderBy: [{ district: { region: { name: 'asc' } } }, { district: { name: 'asc' } }, { fullName: 'asc' }],
      select: specialistSelect,
    });
    response.json({ specialists });
  } catch (error) { next(error); }
});

router.post('/specialists', adminOnly, async (request, response, next) => {
  try {
    const data = specialistData(request.body);
    await requireDistrictExists(data.districtId);
    const specialist = await prisma.user.create({
      data: {
        ...data,
        username: text(request.body?.username, 'Username', 100).toLowerCase(),
        passwordHash: await hashPassword(password(request.body?.password)),
        role: UserRole.PAYMENT_SPECIALIST,
      },
      select: specialistSelect,
    });
    response.status(201).json({ specialist });
  } catch (error) { mapDatabaseError(error, next); }
});

// Moving a specialist to another district keeps their earlier payments in the old district.
router.patch('/specialists/:userId', adminOnly, async (request, response, next) => {
  try {
    const userId = request.params.userId as string;
    await requireSpecialist(userId);
    const data: ReturnType<typeof specialistData> & { username?: string; passwordHash?: string } = specialistData(request.body);
    await requireDistrictExists(data.districtId);
    if (request.body?.username !== undefined) data.username = text(request.body.username, 'Username', 100).toLowerCase();
    if (request.body?.password !== undefined) data.passwordHash = await hashPassword(password(request.body.password));
    const specialist = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({ where: { id: userId }, data, select: specialistSelect });
      if (data.passwordHash) await transaction.session.deleteMany({ where: { userId } });
      return updated;
    });
    response.json({ specialist });
  } catch (error) { mapDatabaseError(error, next); }
});

// Specialists with saved payments cannot be deleted, so the history is preserved.
router.delete('/specialists/:userId', adminOnly, async (request, response, next) => {
  try {
    const userId = request.params.userId as string;
    await requireSpecialist(userId);
    await prisma.user.delete({ where: { id: userId } });
    response.status(204).end();
  } catch (error) { mapDatabaseError(error, next); }
});

export const paymentsRouter = router;
