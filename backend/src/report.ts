import express from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error.js';
import { reportDistrictScope, requireAuth } from './auth.js';
import { prisma } from './db.js';

const router = express.Router();
const employeeSelect = { user: { select: { fullName: true, phone: true } } } satisfies Prisma.EmployeeRegionAssignmentSelect;

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

function tashkentToday(): Date {
  const value = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  return new Date(`${value}T00:00:00.000Z`);
}

// One row per district of the selected region, combining district data with the latest Xatlov snapshot,
// the RAD limit for the report month, the latest overdue stage counts and the latest in-progress MKD per year
// on or before the report date.
router.get('/', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const date = request.query.date === undefined ? tashkentToday() : parseDate(request.query.date);
    const requestedRegionId = request.query.regionId;
    if (requestedRegionId !== undefined && typeof requestedRegionId !== 'string') {
      throw new ApiError(400, 'INVALID_FILTER', 'Region filter must be a string');
    }

    const scope = reportDistrictScope(user);
    const regions = await prisma.region.findMany({
      where: { districts: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const regionId = requestedRegionId ?? regions[0]?.id;
    const region = regions.find((item) => item.id === regionId);
    if (!region) {
      if (requestedRegionId) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this region');
      response.json({ date: date.toISOString().slice(0, 10), regions, region: null, mkdYears: [], rows: [] });
      return;
    }

    const [groupLeader, districts] = await Promise.all([
      prisma.region.findUnique({ where: { id: region.id }, select: { groupLeaderAssignment: { select: employeeSelect } } }),
      prisma.district.findMany({
        where: { AND: [scope, { regionId: region.id }] },
        orderBy: { name: 'asc' },
        include: { republicEmployeeAssignment: { select: employeeSelect }, regionalEmployeeAssignment: { select: employeeSelect } },
      }),
    ]);
    const ids = districts.map((district) => district.id);
    // Weekly migration covers Monday to Sunday of the report date's week, up to the report date.
    const weekStart = new Date(date);
    weekStart.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const weekEnd = date;
    // Working days are Monday to Friday; weekend work raises the total but is not counted as a working day.
    const workDays = Math.min(((date.getUTCDay() + 6) % 7) + 1, 5);
    const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));

    const [xatlovRecords, weeklyXatlov, radLimits, overdue, mkdRecords, mkdYears] = await Promise.all([
      prisma.xatlovRecord.findMany({
        where: { districtId: { in: ids }, recordDate: { lte: date } },
        orderBy: [{ districtId: 'asc' }, { recordDate: 'desc' }],
        distinct: ['districtId'],
      }),
      prisma.xatlovRecord.findMany({
        where: { districtId: { in: ids }, recordDate: { gte: weekStart, lte: weekEnd } },
        select: { districtId: true, recordDate: true, migrationCount: true },
      }),
      // Latest month-to-date RAD snapshot in the report month, on or before the report date.
      prisma.radLimit.findMany({
        where: { districtId: { in: ids }, recordDate: { gte: monthStart, lte: date } },
        orderBy: [{ districtId: 'asc' }, { recordDate: 'desc' }],
        distinct: ['districtId'],
      }),
      prisma.overdueSnapshot.findMany({
        where: { districtId: { in: ids }, recordDate: { lte: date } },
        orderBy: [{ districtId: 'asc' }, { recordDate: 'desc' }],
        distinct: ['districtId'],
      }),
      prisma.mkdRecord.findMany({
        where: { districtId: { in: ids }, recordDate: { lte: date } },
        orderBy: [{ districtId: 'asc' }, { year: 'asc' }, { recordDate: 'desc' }],
        distinct: ['districtId', 'year'],
      }),
      // Every year with MKD data becomes a report column, so all regions share the same columns.
      prisma.mkdRecord.findMany({ where: { recordDate: { lte: date } }, distinct: ['year'], select: { year: true }, orderBy: { year: 'asc' } }),
    ]);

    const rows = districts.map((district) => {
      const xatlov = xatlovRecords.find((record) => record.districtId === district.id);
      const weekly = weeklyXatlov.filter((record) => record.districtId === district.id);
      const rad = radLimits.find((limit) => limit.districtId === district.id);
      const stages = overdue.find((snapshot) => snapshot.districtId === district.id);
      return {
        id: district.id,
        name: district.name,
        republicEmployee: district.republicEmployeeAssignment?.user ?? null,
        regionalEmployee: district.regionalEmployeeAssignment?.user ?? null,
        engineerCount: district.engineerCount,
        xatlovEmployeeCount: district.xatlovEmployeeCount,
        objectCount: district.objectCount,
        mfyCount: district.mfyCount,
        dailyMigrationPlan: district.dailyMigrationPlan,
        xatlov: xatlov ? {
          recordDate: xatlov.recordDate.toISOString().slice(0, 10),
          completedMfyCount: xatlov.completedMfyCount,
          censusCount: xatlov.censusCount,
          completedObjectCount: xatlov.completedObjectCount,
          migrationCount: xatlov.migrationCount,
          paymentDebt: xatlov.paymentDebt === null ? null : xatlov.paymentDebt.toNumber(),
        } : null,
        weeklyMigrationCount: weekly.length ? weekly.reduce((sum, record) => sum + record.migrationCount, 0) : null,
        // Working days (Monday to Friday) of the week up to the report date; 0 when the week has no record.
        weeklyDays: weekly.length ? workDays : 0,
        // Migration on each day of the week, Monday first; null for a day without a record.
        weekMigration: Array.from({ length: 7 }, (_, day) => weekly.find((record) => (record.recordDate.getUTCDay() + 6) % 7 === day)?.migrationCount ?? null),
        rad: rad ? { monthlyLimit: rad.monthlyLimit, rejectedApplications: rad.rejectedApplications } : null,
        overdue1to3: stages?.stage1to3 ?? 0,
        overdue4to7: stages?.stage4to7 ?? 0,
        overdue8to14: stages?.stage8to14 ?? 0,
        overdue15to30: stages?.stage15to30 ?? 0,
        overdueOver30: (stages?.stage31to90 ?? 0) + (stages?.stage90plus ?? 0),
        mkdInProgress: Object.fromEntries(mkdRecords.filter((record) => record.districtId === district.id).map((record) => [record.year, record.inProgressCount])),
      };
    });

    response.json({
      date: date.toISOString().slice(0, 10),
      regions,
      region: { ...region, groupLeader: groupLeader?.groupLeaderAssignment?.user.fullName ?? null },
      mkdYears: mkdYears.map((item) => item.year),
      rows,
    });
  } catch (error) {
    next(error);
  }
});

export const reportRouter = router;
