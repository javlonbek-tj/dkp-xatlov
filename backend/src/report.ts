import express from 'express';
import { Prisma } from '@prisma/client';
import { ApiError } from './api-error.js';
import { readableDistrictScope, requireAuth } from './auth.js';
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
// the RAD limit for the report month, and the latest overdue stage counts on or before the report date.
router.get('/', requireAuth, async (request, response, next) => {
  try {
    const user = request.auth!;
    const date = request.query.date === undefined ? tashkentToday() : parseDate(request.query.date);
    const requestedRegionId = request.query.regionId;
    if (requestedRegionId !== undefined && typeof requestedRegionId !== 'string') {
      throw new ApiError(400, 'INVALID_FILTER', 'Region filter must be a string');
    }

    const scope = readableDistrictScope(user);
    const regions = await prisma.region.findMany({
      where: { districts: { some: scope } },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    const regionId = requestedRegionId ?? regions[0]?.id;
    const region = regions.find((item) => item.id === regionId);
    if (!region) {
      if (requestedRegionId) throw new ApiError(403, 'FORBIDDEN', 'You do not have access to this region');
      response.json({ date: date.toISOString().slice(0, 10), regions, region: null, rows: [] });
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
    // Weekly migration covers Monday to Friday of the report date's week, up to the report date.
    const weekStart = new Date(date);
    weekStart.setUTCDate(date.getUTCDate() - ((date.getUTCDay() + 6) % 7));
    const friday = new Date(weekStart);
    friday.setUTCDate(weekStart.getUTCDate() + 4);
    const weekEnd = date < friday ? date : friday;
    const month = date.getUTCMonth() + 1;
    const year = date.getUTCFullYear();

    const [xatlovRecords, weeklyXatlov, radLimits, overdue] = await Promise.all([
      prisma.xatlovRecord.findMany({
        where: { districtId: { in: ids }, recordDate: { lte: date } },
        orderBy: [{ districtId: 'asc' }, { recordDate: 'desc' }],
        distinct: ['districtId'],
      }),
      prisma.xatlovRecord.groupBy({
        by: ['districtId'],
        where: { districtId: { in: ids }, recordDate: { gte: weekStart, lte: weekEnd } },
        _sum: { migrationCount: true },
        _count: { _all: true },
      }),
      prisma.radLimit.findMany({ where: { districtId: { in: ids }, month, year } }),
      prisma.overdueSnapshot.findMany({
        where: { districtId: { in: ids }, recordDate: { lte: date } },
        orderBy: [{ districtId: 'asc' }, { recordDate: 'desc' }],
        distinct: ['districtId'],
      }),
    ]);

    const rows = districts.map((district) => {
      const xatlov = xatlovRecords.find((record) => record.districtId === district.id);
      const weekly = weeklyXatlov.find((item) => item.districtId === district.id);
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
        xatlov: xatlov ? {
          recordDate: xatlov.recordDate.toISOString().slice(0, 10),
          completedMfyCount: xatlov.completedMfyCount,
          censusCount: xatlov.censusCount,
          completedObjectCount: xatlov.completedObjectCount,
          migrationCount: xatlov.migrationCount,
          paymentDebt: xatlov.paymentDebt === null ? null : xatlov.paymentDebt.toNumber(),
        } : null,
        weeklyMigrationCount: weekly?._sum.migrationCount ?? null,
        // Days worked this week = days with a saved record from Monday on.
        weeklyDays: weekly?._count._all ?? 0,
        rad: rad ? { monthlyLimit: rad.monthlyLimit, rejectedApplications: rad.rejectedApplications } : null,
        overdue15to30: stages?.stage15to30 ?? 0,
        overdueOver30: (stages?.stage31to90 ?? 0) + (stages?.stage90plus ?? 0),
      };
    });

    response.json({
      date: date.toISOString().slice(0, 10),
      regions,
      region: { ...region, groupLeader: groupLeader?.groupLeaderAssignment?.user.fullName ?? null },
      rows,
    });
  } catch (error) {
    next(error);
  }
});

export const reportRouter = router;
