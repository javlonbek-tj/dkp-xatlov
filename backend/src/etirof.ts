import express from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { reportDistrictScope, requireAuth, requireRole } from './auth.js';
import { tashkentToday } from './dashboard.js';
import { prisma } from './db.js';

const router = express.Router();
router.use(requireAuth);
const readers = requireRole(UserRole.ADMIN, UserRole.REPUBLIC_EMPLOYEE, UserRole.REGIONAL_EMPLOYEE, UserRole.VIEWER);

const dayFields = ['toPublic', 'toAdliya', 'adliyaToPayment', 'editToAdliya', 'paid'] as const;
const kengashFields = ['kengashTotal', 'kengashInTerm', 'kengashOver90'] as const;
const recordSelect = {
  districtId: true, recordDate: true, dayAsOf: true, kengashAsOf: true,
  ...Object.fromEntries([...dayFields, ...kengashFields].map((field) => [field, true])),
} as const;

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

function parseDateTime(value: unknown, field: string): Date {
  const date = typeof value === 'string' ? new Date(value) : new Date(Number.NaN);
  if (Number.isNaN(date.getTime())) throw new ApiError(400, 'INVALID_DATE', `${field}: sana va vaqt noto‘g‘ri`);
  return date;
}

// The svod comes in Uzbek Cyrillic ("Навоий шаҳри", "Ғозғон шаҳри"); saved names are Latin ("Navoiy shahar", "G‘ozg‘on shahar").
const cyrillic: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o',
  п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 's', ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu',
  я: 'ya', ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};
export function normalizeName(value: string) {
  return value.toLowerCase()
    // "е" at the start of a word or after a vowel is read "ye".
    .replace(/(^|[\s(аеёиоуўэюя])е/g, '$1ye')
    .replace(/[а-яёўқғҳ]/g, (letter) => cyrillic[letter] ?? letter)
    .replace(/[‘’ʻʼ`´']/g, '')
    .replace(/\bshahri\b/g, 'shahar')
    .replace(/\s+/g, ' ')
    .trim();
}

// Regions that have at least one record are listed first by the latest record, so the default region has data.
router.get('/', readers, async (request, response, next) => {
  try {
    const user = request.auth!;
    const date = request.query.date === undefined ? tashkentToday().date : parseDate(request.query.date);
    const previousDate = new Date(date);
    previousDate.setUTCDate(date.getUTCDate() - 1);
    const requestedRegionId = request.query.regionId;
    if (requestedRegionId !== undefined && typeof requestedRegionId !== 'string') {
      throw new ApiError(400, 'INVALID_FILTER', 'Region filter must be a string');
    }

    const scope = reportDistrictScope(user);
    const [regions, latest, latestAdliya] = await Promise.all([
      prisma.region.findMany({ where: { districts: { some: scope } }, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
      prisma.etirofRecord.findFirst({ where: { district: scope }, orderBy: { updatedAt: 'desc' }, select: { district: { select: { regionId: true } } } }),
      prisma.adliyaSnapshot.findFirst({ where: { district: scope }, orderBy: { updatedAt: 'desc' }, select: { district: { select: { regionId: true } } } }),
    ]);
    const regionId = requestedRegionId ?? latest?.district.regionId ?? latestAdliya?.district.regionId ?? regions[0]?.id;
    const region = regions.find((item) => item.id === regionId);
    // Republic employees load the svod of the regions they are assigned to; the listed regions are only those.
    const canImport = user.role === UserRole.ADMIN || user.role === UserRole.REPUBLIC_EMPLOYEE;
    const result = { date: date.toISOString().slice(0, 10), previousDate: previousDate.toISOString().slice(0, 10), regions, canImport };
    if (!region) {
      if (requestedRegionId) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this region');
      response.json({ ...result, region: null, rows: [] });
      return;
    }

    const districts = await prisma.district.findMany({
      where: { AND: [scope, { regionId: region.id }] },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const records = await prisma.etirofRecord.findMany({
      where: { districtId: { in: districts.map((district) => district.id) }, recordDate: { in: [previousDate, date] } },
      select: recordSelect,
    });
    const snapshots = await prisma.adliyaSnapshot.findMany({
      where: { districtId: { in: districts.map((district) => district.id) }, recordDate: date },
      select: { districtId: true, morning: true, asOf: true, inPublic: true, inAdliya: true, inPayment: true, returned: true },
    });
    const snapshot = (districtId: string, morning: boolean) => {
      const item = snapshots.find((row) => row.districtId === districtId && row.morning === morning);
      return item ? { ...item, districtId: undefined, morning: undefined } : null;
    };
    const find = (districtId: string, day: Date) => {
      const record = records.find((item) => item.districtId === districtId && item.recordDate.getTime() === day.getTime());
      return record ? { ...record, districtId: undefined, recordDate: undefined } : null;
    };
    response.json({
      ...result,
      region,
      rows: districts.map((district) => ({
        ...district, previous: find(district.id, previousDate), current: find(district.id, date),
        adliyaMorning: snapshot(district.id, true), adliyaLatest: snapshot(district.id, false),
      })),
    });
  } catch (error) { next(error); }
});

// Saves the sheets of one svod file (one sheet per day). A day already saved for a district is replaced,
// so today's numbers can be loaded again later in the day. Nothing is saved when a row is invalid.
router.post('/import', requireRole(UserRole.ADMIN, UserRole.REPUBLIC_EMPLOYEE), async (request, response, next) => {
  try {
    const user = request.auth!;
    const sheets = (request.body as { sheets?: unknown } | undefined)?.sheets;
    if (!Array.isArray(sheets) || sheets.length === 0 || sheets.length > 10) throw new ApiError(400, 'INVALID_SHEETS', 'Faylda 1 tadan 10 tagacha varaq bo‘lishi kerak');
    const [regions, districts, assigned] = await Promise.all([
      prisma.region.findMany({ select: { id: true, name: true } }),
      prisma.district.findMany({ select: { id: true, name: true, regionId: true } }),
      prisma.employeeRegionAssignment.findMany({ where: { userId: user.id }, select: { regionId: true } }),
    ]);
    const today = tashkentToday().date;
    const errors: string[] = [];
    const data: { districtId: string; recordDate: Date; values: Prisma.EtirofRecordUncheckedUpdateInput }[] = [];

    sheets.forEach((sheet, sheetIndex) => {
      const input = (sheet ?? {}) as Record<string, unknown>;
      const name = typeof input.name === 'string' ? input.name : `${sheetIndex + 1}-varaq`;
      const recordDate = parseDate(input.date);
      if (recordDate > today) throw new ApiError(400, 'INVALID_DATE', `"${name}": kelajakdagi sana (${input.date}) uchun ma’lumot kiritib bo‘lmaydi`);
      const kengashAsOf = parseDateTime(input.kengashAsOf, name);
      const dayAsOf = input.dayAsOf === null || input.dayAsOf === undefined ? null : parseDateTime(input.dayAsOf, name);
      // The region is named in the title, e.g. "Навоий вилояти бўйича ...".
      const title = typeof input.title === 'string' ? normalizeName(input.title) : '';
      const region = regions.find((item) => title.includes(normalizeName(item.name)));
      if (!region) throw new ApiError(400, 'INVALID_REGION', `"${name}": sarlavhadan viloyat aniqlanmadi`);
      if (user.role !== UserRole.ADMIN && !assigned.some((item) => item.regionId === region.id)) {
        throw new ApiError(403, 'FORBIDDEN', `"${name}": siz ${region.name}ga biriktirilmagansiz`);
      }
      const byName = new Map(districts.filter((item) => item.regionId === region.id).map((item) => [normalizeName(item.name), item.id]));
      const rows = input.rows;
      if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100) throw new ApiError(400, 'INVALID_ROWS', `"${name}": tumanlar ro‘yxati topilmadi`);
      const seen = new Set<string>();
      rows.forEach((row, rowIndex) => {
        const values = (row ?? {}) as Record<string, unknown>;
        const line = `"${name}", ${typeof values.line === 'number' ? values.line : rowIndex + 1}-qator`;
        const districtId = typeof values.district === 'string' ? byName.get(normalizeName(values.district)) : undefined;
        if (!districtId) { errors.push(`${line}: "${String(values.district ?? '')}" tumani ${region.name}da topilmadi`); return; }
        if (seen.has(districtId)) { errors.push(`${line}: tuman takrorlangan`); return; }
        seen.add(districtId);
        const numbers: Record<string, number> = {};
        for (const field of [...dayFields, ...kengashFields]) {
          const value = values[field];
          if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10_000_000) errors.push(`${line}: raqamlar butun va manfiy bo‘lmagan son bo‘lishi kerak`);
          else numbers[field] = value;
        }
        if (Object.keys(numbers).length < dayFields.length + kengashFields.length) return;
        if (numbers.kengashInTerm > numbers.kengashTotal) errors.push(`${line}: muddat ichidagilar jamidan ko‘p`);
        else if (numbers.kengashOver90 > numbers.kengashTotal - numbers.kengashInTerm) errors.push(`${line}: 90 kundan ortiqlar muddati o‘tganlardan ko‘p`);
        else data.push({ districtId, recordDate, values: { ...numbers, dayAsOf, kengashAsOf } });
      });
    });
    if (errors.length) throw new ApiError(400, 'INVALID_ROWS', `Fayldagi xatolar (${errors.length} ta): ${errors.slice(0, 10).join('; ')}${errors.length > 10 ? '; …' : ''}`);
    const keys = new Set(data.map((item) => `${item.districtId}/${item.recordDate.toISOString()}`));
    if (keys.size !== data.length) throw new ApiError(400, 'INVALID_SHEETS', 'Bir kunning ma’lumoti faylda ikki marta berilgan');

    await prisma.$transaction(data.map((item) => prisma.etirofRecord.upsert({
      where: { districtId_recordDate: { districtId: item.districtId, recordDate: item.recordDate } },
      create: { districtId: item.districtId, recordDate: item.recordDate, ...item.values } as Prisma.EtirofRecordUncheckedCreateInput,
      update: item.values,
    })));
    response.json({ saved: data.length, dates: [...new Set(data.map((item) => item.recordDate.toISOString().slice(0, 10)))].sort() });
  } catch (error) { next(error); }
});

// Saves the "Адлияда турганлар" svod. The first upload of a day for a region is that day's morning snapshot;
// every later upload replaces the day's latest snapshot, which the page compares with the morning one.
const adliyaFields = ['inPublic', 'inAdliya', 'inPayment', 'returned'] as const;
router.post('/adliya/import', requireRole(UserRole.ADMIN, UserRole.REPUBLIC_EMPLOYEE), async (request, response, next) => {
  try {
    const user = request.auth!;
    const input = (request.body ?? {}) as Record<string, unknown>;
    const asOf = parseDateTime(input.asOf, 'Fayl sarlavhasi');
    const recordDate = tashkentToday(asOf).date;
    if (recordDate > tashkentToday().date) throw new ApiError(400, 'INVALID_DATE', 'Kelajakdagi sana uchun ma’lumot kiritib bo‘lmaydi');
    const title = typeof input.title === 'string' ? normalizeName(input.title) : '';
    const region = (await prisma.region.findMany({ select: { id: true, name: true } })).find((item) => title.includes(normalizeName(item.name)));
    if (!region) throw new ApiError(400, 'INVALID_REGION', 'Sarlavhadan viloyat aniqlanmadi');
    if (user.role !== UserRole.ADMIN && (await prisma.employeeRegionAssignment.count({ where: { userId: user.id, regionId: region.id } })) === 0) {
      throw new ApiError(403, 'FORBIDDEN', `Siz ${region.name}ga biriktirilmagansiz`);
    }
    const rows = input.rows;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 100) throw new ApiError(400, 'INVALID_ROWS', 'Faylda tumanlar ro‘yxati topilmadi');

    const districts = await prisma.district.findMany({ where: { regionId: region.id }, select: { id: true, name: true } });
    const byName = new Map(districts.map((item) => [normalizeName(item.name), item.id]));
    const errors: string[] = [];
    const seen = new Set<string>();
    const data: { districtId: string; values: Record<(typeof adliyaFields)[number], number> }[] = [];
    rows.forEach((row, index) => {
      const values = (row ?? {}) as Record<string, unknown>;
      const line = `${typeof values.line === 'number' ? values.line : index + 1}-qator`;
      const districtId = typeof values.district === 'string' ? byName.get(normalizeName(values.district)) : undefined;
      if (!districtId) { errors.push(`${line}: "${String(values.district ?? '')}" tumani ${region.name}da topilmadi`); return; }
      if (seen.has(districtId)) { errors.push(`${line}: tuman takrorlangan`); return; }
      seen.add(districtId);
      if (adliyaFields.some((field) => !Number.isInteger(values[field]) || (values[field] as number) < 0 || (values[field] as number) > 10_000_000)) {
        errors.push(`${line}: raqamlar butun va manfiy bo‘lmagan son bo‘lishi kerak`);
        return;
      }
      data.push({ districtId, values: Object.fromEntries(adliyaFields.map((field) => [field, values[field] as number])) as Record<(typeof adliyaFields)[number], number> });
    });
    if (errors.length) throw new ApiError(400, 'INVALID_ROWS', `Fayldagi xatolar (${errors.length} ta): ${errors.slice(0, 10).join('; ')}${errors.length > 10 ? '; …' : ''}`);

    const morning = (await prisma.adliyaSnapshot.count({ where: { recordDate, morning: true, district: { regionId: region.id } } })) === 0;
    await prisma.$transaction(data.map((item) => prisma.adliyaSnapshot.upsert({
      where: { districtId_recordDate_morning: { districtId: item.districtId, recordDate, morning } },
      create: { districtId: item.districtId, recordDate, morning, asOf, ...item.values },
      update: { asOf, ...item.values },
    })));
    response.json({ saved: data.length, date: recordDate.toISOString().slice(0, 10), morning });
  } catch (error) { next(error); }
});

export { router as etirofRouter };
