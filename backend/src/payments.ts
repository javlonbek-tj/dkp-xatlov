import express, { type NextFunction, type Request } from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { reportDistrictScope, requireAuth, requireRole } from './auth.js';
import { tashkentToday } from './dashboard.js';
import { prisma } from './db.js';
import { hashPassword } from './password.js';
import { workDays } from './xatlov-plan.js';

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
    applicationNumber: applicationNumber(input.applicationNumber),
    amount: new Prisma.Decimal(amount.toFixed(6)),
  };
}

// Application numbers are kept in upper case without spaces.
function applicationNumber(value: unknown): string {
  return text(value, 'Application number', 50).replace(/\s+/g, '').toUpperCase();
}

// Amounts of applications are compared in whole so'm.
const toSom = (mln: Prisma.Decimal | number) => Math.round(Number(mln) * 1_000_000);
const formatSom = (som: number) => som.toLocaleString('ru-RU');
const formatDate = (date: Date) => date.toISOString().slice(0, 10).split('-').reverse().join('.');

// Debt, collected sum and what is left of an application, in so'm.
function applicationState(debtMln: Prisma.Decimal, paidMln: Prisma.Decimal | null) {
  const debt = toSom(debtMln);
  const paid = toSom(paidMln ?? 0);
  const remaining = Math.max(debt - paid, 0);
  return { debt, paid, remaining, status: remaining === 0 ? 'PAID' : paid > 0 ? 'PARTIAL' : 'UNPAID' };
}

// A payment must belong to a known application of the payment's district and may not exceed what is left of it.
// The application row is locked so that two payments at the same time cannot both use the same remainder.
async function checkApplication(db: Prisma.TransactionClient, number: string, districtId: string, amount: Prisma.Decimal, exceptRecordId?: string) {
  await db.$queryRaw`SELECT "id" FROM "PaymentApplication" WHERE "number" = ${number} FOR UPDATE`;
  const application = await db.paymentApplication.findUnique({ where: { number } });
  if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Ariza topilmadi');
  if (application.districtId !== districtId) throw new ApiError(403, 'APPLICATION_OTHER_DISTRICT', 'Bu ariza sizning tumaningizga tegishli emas');
  const others = { applicationNumber: number, ...(exceptRecordId ? { id: { not: exceptRecordId } } : {}) };
  const paid = await db.paymentRecord.aggregate({ where: others, _sum: { amount: true } });
  const state = applicationState(application.debt, paid._sum.amount);
  if (state.remaining === 0) {
    const last = await db.paymentRecord.findFirst({ where: others, orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }], select: { recordDate: true, user: { select: { fullName: true } } } });
    throw new ApiError(409, 'APPLICATION_PAID', last
      ? `Bu ariza bo‘yicha to‘lov to‘liq undirilgan (oxirgi to‘lov ${formatDate(last.recordDate)}, ${last.user.fullName})`
      : 'Bu ariza bo‘yicha qarzdorlik yo‘q (to‘liq undirilgan)');
  }
  if (toSom(amount) > state.remaining) {
    throw new ApiError(400, 'AMOUNT_EXCEEDS_REMAINING', `Summa ariza qoldig‘idan oshmasligi kerak. Qoldiq: ${formatSom(state.remaining)} so‘m`);
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

// The plan to collect the applications' debt starts the day after this date and ends on 31 December.
const planBaseDate = '2026-11-05';
const planDeadline = `${planBaseDate.slice(0, 4)}-12-31`;
const planBase = new Date(`${planBaseDate}T00:00:00.000Z`);

// Monday of the date's week up to the date, as on the Xatlov page; and the month up to the date.
function periods(date: Date) {
  const weekStart = new Date(date);
  weekStart.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
  const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
  return { weekStart, weekEnd: date, monthStart };
}

type Totals = { count: number; amount: number };
const emptyTotals = (): { daily: Totals; weekly: Totals; monthly: Totals } => ({ daily: { count: 0, amount: 0 }, weekly: { count: 0, amount: 0 }, monthly: { count: 0, amount: 0 } });

// Daily, weekly (Mon–Sun) and monthly payment counts and sums per key, from the records of the month up to the date.
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
    const districtId = user.districtId;
    const payment = parsePayment(request.body);
    const record = await prisma.$transaction(async (transaction) => {
      await checkApplication(transaction, payment.applicationNumber, districtId, payment.amount);
      return transaction.paymentRecord.create({ data: { ...payment, userId: user.id, districtId } });
    });
    response.status(201).json({ record });
  } catch (error) { next(error); }
});

router.patch('/records/:recordId', requireRole(UserRole.PAYMENT_SPECIALIST, UserRole.ADMIN), async (request, response, next) => {
  try {
    const existing = await requireEditableRecord(request);
    const payment = parsePayment(request.body);
    const record = await prisma.$transaction(async (transaction) => {
      await checkApplication(transaction, payment.applicationNumber, existing.districtId, payment.amount, existing.id);
      return transaction.paymentRecord.update({ where: { id: existing.id }, data: payment });
    });
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
    const [districts, specialists, records, debts] = await Promise.all([
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
      // The plan of each district is the debt of its applications at import; payments do not change it.
      prisma.paymentApplication.groupBy({ by: ['districtId'], where: { district: locationFilter }, _sum: { debt: true } }),
    ]);
    const debtByDistrict = new Map(debts.map((item) => [item.districtId, item._sum.debt?.toNumber() ?? 0]));
    // Working days of the plan, after the base date up to the deadline, in a 5-day week without holidays.
    const planWorkDays = workDays(planBase, 5, planDeadline);
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
        .filter((district) => specialistCount.has(district.id) || byDistrict.has(district.id) || debtByDistrict.has(district.id))
        .map((district) => ({
          ...district,
          specialistCount: specialistCount.get(district.id) ?? 0,
          ...(byDistrict.get(district.id) ?? emptyTotals()),
          paymentDebt: debtByDistrict.get(district.id) ?? null,
        })),
      plan: { baseDate: planBaseDate, deadline: planDeadline, workDays: planWorkDays },
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

// ---- Applications with a payment debt ----

const applicationSelect = {
  number: true, debt: true,
  district: { select: { id: true, name: true, regionId: true, region: { select: { id: true, name: true } } } },
} satisfies Prisma.PaymentApplicationSelect;

// Every application in the report scope with its collected sum and status.
router.get('/applications', readers, async (request, response, next) => {
  try {
    const regionId = request.query.regionId;
    const districtId = request.query.districtId;
    if ([regionId, districtId].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Filter values must be strings');
    }
    const district: Prisma.DistrictWhereInput = {
      ...reportDistrictScope(request.auth!),
      ...(regionId ? { regionId: regionId as string } : {}),
      ...(districtId ? { id: districtId as string } : {}),
    };
    const [applications, paid] = await Promise.all([
      prisma.paymentApplication.findMany({ where: { district }, orderBy: [{ district: { name: 'asc' } }, { number: 'asc' }], select: applicationSelect }),
      prisma.paymentRecord.groupBy({ by: ['applicationNumber'], where: { district }, _sum: { amount: true } }),
    ]);
    const paidByNumber = new Map(paid.map((item) => [item.applicationNumber, item._sum.amount]));
    response.json({
      applications: applications.map(({ debt, ...item }) => ({ ...item, ...applicationState(debt, paidByNumber.get(item.number) ?? null) })),
      canImport: request.auth!.role === UserRole.ADMIN,
    });
  } catch (error) { next(error); }
});

// One application, looked up while a payment is entered; specialists see only their district's applications.
router.get('/applications/:number', requireRole(UserRole.PAYMENT_SPECIALIST, UserRole.ADMIN), async (request, response, next) => {
  try {
    const user = request.auth!;
    const number = applicationNumber(request.params.number);
    const application = await prisma.paymentApplication.findUnique({ where: { number }, select: applicationSelect });
    if (!application) throw new ApiError(404, 'APPLICATION_NOT_FOUND', 'Ariza topilmadi');
    if (user.role === UserRole.PAYMENT_SPECIALIST) {
      const specialist = await prisma.user.findUnique({ where: { id: user.id }, select: { districtId: true } });
      if (application.district.id !== specialist?.districtId) throw new ApiError(403, 'APPLICATION_OTHER_DISTRICT', 'Bu ariza sizning tumaningizga tegishli emas');
    }
    const [paid, last] = await Promise.all([
      prisma.paymentRecord.aggregate({ where: { applicationNumber: number }, _sum: { amount: true } }),
      prisma.paymentRecord.findFirst({ where: { applicationNumber: number }, orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }], select: { recordDate: true, user: { select: { fullName: true } } } }),
    ]);
    const { debt, ...item } = application;
    response.json({ application: { ...item, ...applicationState(debt, paid._sum.amount), lastPayment: last && { recordDate: last.recordDate, fullName: last.user.fullName } } });
  } catch (error) { next(error); }
});

// District names of the file ("G'ozg'on shahar filiali") compared with the saved ones ("G‘ozg‘on shahar").
const normalizeName = (value: string) => value.toLowerCase().replace(/[‘’ʻʼ`´]/g, "'").replace(/\bfiliali\b/g, '').replace(/\s+/g, ' ').trim();

// Adds applications from an Excel file (district, number, debt in so'm). Numbers already saved are left unchanged.
// Nothing is saved when a row is invalid, so the file can be corrected and loaded again.
router.post('/applications/import', adminOnly, async (request, response, next) => {
  try {
    const rows = (request.body as { rows?: unknown } | undefined)?.rows;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 20_000) throw new ApiError(400, 'INVALID_ROWS', 'Faylda 1 tadan 20 000 tagacha ariza bo‘lishi kerak');
    const districts = await prisma.district.findMany({ select: { id: true, name: true } });
    // A name used in two regions is ambiguous and is not matched.
    const byName = new Map<string, string | null>();
    for (const district of districts) {
      const name = normalizeName(district.name);
      byName.set(name, byName.has(name) ? null : district.id);
    }
    const errors: string[] = [];
    const seen = new Set<string>();
    const data: { number: string; districtId: string; debt: Prisma.Decimal }[] = [];
    rows.forEach((row, index) => {
      const input = (row ?? {}) as Record<string, unknown>;
      const line = `${index + 2}-qator`;
      const number = typeof input.number === 'string' || typeof input.number === 'number' ? String(input.number).replace(/\s+/g, '').toUpperCase() : '';
      const districtId = typeof input.district === 'string' ? byName.get(normalizeName(input.district)) : undefined;
      const debt = typeof input.debt === 'number' && Number.isFinite(input.debt) && input.debt >= 0 && input.debt < 1e17 ? input.debt : null;
      if (!number || number.length > 50) errors.push(`${line}: ariza raqami noto‘g‘ri`);
      else if (seen.has(number)) errors.push(`${line}: ${number} raqami faylda takrorlangan`);
      if (!districtId) errors.push(`${line}: "${String(input.district ?? '')}" tumani topilmadi`);
      if (debt === null) errors.push(`${line}: qoldiq summasi noto‘g‘ri`);
      seen.add(number);
      if (number && districtId && debt !== null) data.push({ number, districtId, debt: new Prisma.Decimal((Math.round(debt) / 1_000_000).toFixed(6)) });
    });
    if (errors.length) throw new ApiError(400, 'INVALID_ROWS', `Fayldagi xatolar (${errors.length} ta): ${errors.slice(0, 10).join('; ')}${errors.length > 10 ? '; …' : ''}`);
    const result = await prisma.paymentApplication.createMany({ data, skipDuplicates: true });
    response.json({ added: result.count, skipped: data.length - result.count });
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
