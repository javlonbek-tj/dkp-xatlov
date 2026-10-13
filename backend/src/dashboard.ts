import express from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { requireAuth } from './auth.js';
import { prisma } from './db.js';

const router = express.Router();
const stageKeys = ['1-3', '4-7', '8-14', '15-30', '31-90', '90+'] as const;
type Stage = (typeof stageKeys)[number];
const stageFieldByKey = {
  '1-3': 'stage1to3', '4-7': 'stage4to7', '8-14': 'stage8to14', '15-30': 'stage15to30', '31-90': 'stage31to90', '90+': 'stage90plus',
} as const satisfies Record<Stage, string>;

function parseDate(value: unknown, field: string): Date | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ApiError(400, 'INVALID_FILTER', `${field} must use YYYY-MM-DD format`);
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
    throw new ApiError(400, 'INVALID_FILTER', `Enter a valid ${field.toLowerCase()}`);
  }
  return date;
}

function tashkentToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tashkent', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: string) => parts.find((item) => item.type === type)!.value;
  return { date: new Date(`${part('year')}-${part('month')}-${part('day')}T00:00:00.000Z`), month: Number(part('month')), year: Number(part('year')) };
}

// Republic and regional employees see figures for every district in the regions they are assigned to.
function districtScope(userId: string, role: UserRole): Prisma.DistrictWhereInput {
  if (role === UserRole.ADMIN) return {};
  return { region: { employeeAssignments: { some: { userId } } } };
}

function sum<T>(values: readonly T[], get: (value: T) => number): number {
  return values.reduce((total, value) => total + get(value), 0);
}

router.get('/', requireAuth, async (request, response, next) => {
  try {
    const regionId = request.query.regionId;
    const districtId = request.query.districtId;
    if ([regionId, districtId].some((value) => value !== undefined && typeof value !== 'string')) {
      throw new ApiError(400, 'INVALID_FILTER', 'Region and district filters must be strings');
    }
    const from = parseDate(request.query.from, 'Start date');
    const to = parseDate(request.query.to, 'End date');
    if (from && to && from > to) throw new ApiError(400, 'INVALID_FILTER', 'The start date must not be after the end date');

    const user = request.auth!;
    const scope = districtScope(user.id, user.role);
    const regionScope: Prisma.RegionWhereInput = user.role === UserRole.ADMIN ? {} : { employeeAssignments: { some: { userId: user.id } } };
    const [accessibleDistricts, accessibleRegions] = await Promise.all([
      prisma.district.findMany({
        where: scope,
        select: { id: true, name: true, regionId: true, region: { select: { id: true, name: true } } },
        orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
      }),
      prisma.region.findMany({ where: regionScope, select: { id: true, name: true }, orderBy: { name: 'asc' } }),
    ]);
    const selectedDistricts = accessibleDistricts.filter((district) =>
      (!regionId || district.regionId === regionId) && (!districtId || district.id === districtId),
    );
    const selectedRegionIds = districtId ? new Set(selectedDistricts.map((district) => district.regionId)) : null;
    const selectedRegions = accessibleRegions.filter((region) =>
      (!regionId || region.id === regionId) && (!selectedRegionIds || selectedRegionIds.has(region.id)),
    );
    const ids = selectedDistricts.map((district) => district.id);
    const today = tashkentToday();
    const dateFilter = from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;

    const [xatlovRows, mkdRows, radAggregate, overdueRows] = await Promise.all([
      prisma.xatlovRecord.findMany({
        where: { districtId: { in: ids }, ...(dateFilter ? { recordDate: dateFilter } : {}) },
        select: { districtId: true, recordDate: true, completedMfyCount: true, censusCount: true, migrationCount: true },
        orderBy: [{ recordDate: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.mkdRecord.findMany({
        where: { districtId: { in: ids }, ...(dateFilter ? { targetDate: dateFilter } : {}) },
        select: { districtId: true, type: true, targetDate: true, totalBuildings: true, completedBuildings: true, plannedBuildings: true, completedAgainstPlan: true },
        orderBy: [{ targetDate: 'desc' }, { createdAt: 'desc' }],
      }),
      prisma.radLimit.aggregate({
        where: { districtId: { in: ids }, month: today.month, year: today.year },
        _sum: { monthlyLimit: true, rejectedApplications: true },
      }),
      prisma.overdueSnapshot.findMany({
        where: { districtId: { in: ids }, ...(dateFilter ? { recordDate: dateFilter } : {}) },
        orderBy: [{ districtId: 'asc' }, { recordDate: 'desc' }],
        distinct: ['districtId'],
      }),
    ]);

    const latestXatlov = new Map<string, (typeof xatlovRows)[number]>();
    for (const row of xatlovRows) if (!latestXatlov.has(row.districtId)) latestXatlov.set(row.districtId, row);
    const latestMkd = new Map<string, (typeof mkdRows)[number]>();
    for (const row of mkdRows) {
      const key = `${row.districtId}:${row.type}`;
      if (!latestMkd.has(key)) latestMkd.set(key, row);
    }
    const xatlov = [...latestXatlov.values()];
    const mkd = [...latestMkd.values()];
    // Latest overdue stage counts per district, summed.
    const overdueStages = Object.fromEntries(stageKeys.map((stage) => [stage, sum(overdueRows, (row) => row[stageFieldByKey[stage]])])) as Record<Stage, number>;
    const overdueTotal = sum(stageKeys, (stage) => overdueStages[stage]);
    const currentMonthLimit = radAggregate._sum.monthlyLimit ?? 0;
    const rejectedApplications = radAggregate._sum.rejectedApplications ?? 0;
    response.json({
      filters: { from: from?.toISOString().slice(0, 10) ?? null, to: to?.toISOString().slice(0, 10) ?? null, radMonth: today.month, radYear: today.year },
      regions: accessibleRegions,
      districts: accessibleDistricts,
      geography: { regionCount: selectedRegions.length, districtCount: selectedDistricts.length },
      xatlov: {
        districtCount: xatlov.length,
        completedMfyCount: sum(xatlov, (row) => row.completedMfyCount),
        censusCount: sum(xatlov, (row) => row.censusCount),
        migrationCount: sum(xatlov, (row) => row.migrationCount),
      },
      mkd: {
        totalBuildings: sum(mkd, (row) => row.totalBuildings),
        completedBuildings: sum(mkd, (row) => row.completedBuildings),
        remainingBuildings: sum(mkd, (row) => row.totalBuildings - row.completedBuildings),
        plannedBuildings: sum(mkd, (row) => row.plannedBuildings),
        completedAgainstPlan: sum(mkd, (row) => row.completedAgainstPlan),
        remainingPlan: sum(mkd, (row) => row.plannedBuildings - row.completedAgainstPlan),
      },
      rad: { month: today.month, year: today.year, monthlyLimit: currentMonthLimit, rejectedApplications, remainingLimit: currentMonthLimit - rejectedApplications },
      overdue: { total: overdueTotal, stages: stageKeys.map((stage) => ({ stage, count: overdueStages[stage] })) },
    });
  } catch (error) { next(error); }
});

export const dashboardRouter = router;
