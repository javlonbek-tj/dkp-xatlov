import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { requireAuth, requireRole } from './auth.js';
import { prisma } from './db.js';
import { hashPassword } from './password.js';

const router = express.Router();
const adminOnly = requireRole(UserRole.ADMIN);
router.use(requireAuth);

// Administrators manage every region; group leaders manage only the regions they lead.
async function managedRegionIds(request: Request): Promise<string[] | null> {
  const user = request.auth!;
  if (user.role === UserRole.ADMIN) return null;
  const regions = await prisma.region.findMany({
    where: { groupLeaderAssignment: { is: { userId: user.id } } },
    select: { id: true },
  });
  if (regions.length === 0) throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action');
  return regions.map((region) => region.id);
}

async function requireRegionAccess(request: Request, regionId: string) {
  const regionIds = await managedRegionIds(request);
  if (regionIds && !regionIds.includes(regionId)) {
    throw new ApiError(403, 'FORBIDDEN', 'You can only manage the regions you lead');
  }
  return regionIds;
}

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new ApiError(400, 'INVALID_INPUT', `${field} is required and must be at most ${maxLength} characters`);
  }
  return value.trim();
}

function password(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200) {
    throw new ApiError(400, 'INVALID_INPUT', 'Password is required and must be at most 200 characters');
  }
  return value;
}

function optionalId(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' || value.length > 100) {
    throw new ApiError(400, 'INVALID_INPUT', `${field} must be a valid ID or empty`);
  }
  return value;
}

function optionalPhone(value: unknown): string | null {
  if (value === null || value === undefined || (typeof value === 'string' && value.trim() === '')) return null;
  if (typeof value !== 'string' || !/^\+?[\d\s()-]{5,30}$/.test(value.trim())) {
    throw new ApiError(400, 'INVALID_PHONE', 'Phone number may contain only digits, spaces, brackets, dashes and a leading +');
  }
  return value.trim();
}

function mapDatabaseError(error: unknown, next: NextFunction): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      next(new ApiError(409, 'DUPLICATE_RECORD', 'A record with these details already exists'));
      return;
    }
    if (error.code === 'P2003' || error.code === 'P2014') {
      next(new ApiError(409, 'RECORD_IN_USE', 'This record is still referenced by other records'));
      return;
    }
    if (error.code === 'P2025') {
      next(new ApiError(404, 'RECORD_NOT_FOUND', 'Record not found'));
      return;
    }
  }
  next(error);
}

async function requireEmployeeAssignment(
  assignmentId: string | null,
  regionId: string,
  role: 'REPUBLIC_EMPLOYEE' | 'REGIONAL_EMPLOYEE',
  field: string,
) {
  if (assignmentId === null) return null;
  const assignment = await prisma.employeeRegionAssignment.findUnique({
    where: { id: assignmentId },
    include: { user: { select: { role: true } } },
  });
  if (!assignment || assignment.regionId !== regionId || assignment.user.role !== role) {
    throw new ApiError(400, 'INVALID_ASSIGNMENT', `${field} must be an employee of the matching type in this region`);
  }
  return assignment.id;
}

router.get('/users', async (request, response, next) => {
  try {
    const regionIds = await managedRegionIds(request);
    const users = await prisma.user.findMany({
      where: regionIds ? { role: { not: UserRole.ADMIN } } : undefined,
      orderBy: { fullName: 'asc' },
      select: {
        id: true,
        username: true,
        fullName: true,
        phone: true,
        role: true,
        regionAssignments: {
          include: { region: { select: { id: true, name: true } } },
        },
      },
    });
    response.json({ users });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.post('/users', adminOnly, async (request, response, next) => {
  try {
    const username = text(request.body?.username, 'Username', 100).toLowerCase();
    const fullName = text(request.body?.fullName, 'Full name', 150);
    const userPassword = password(request.body?.password);
    const role = request.body?.role as UserRole;
    // District heads are created from their district so they are always linked to it.
    if (!Object.values(UserRole).includes(role) || role === UserRole.DISTRICT_HEAD) {
      throw new ApiError(400, 'INVALID_ROLE', 'Choose a valid employee role');
    }

    const user = await prisma.user.create({
      data: { username, fullName, phone: optionalPhone(request.body?.phone), passwordHash: await hashPassword(userPassword), role },
      select: { id: true, username: true, fullName: true, phone: true, role: true },
    });
    response.status(201).json({ user });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.patch('/users/:userId', async (request, response, next) => {
  try {
    const userId = request.params.userId as string;
    // Group leaders may edit only the name and phone of employees assigned to a region they lead.
    const regionIds = await managedRegionIds(request);
    if (regionIds) {
      if (request.body?.password !== undefined || request.body?.role !== undefined) {
        throw new ApiError(403, 'FORBIDDEN', 'Group leaders can change only the full name and phone number');
      }
      const inLedRegion = await prisma.employeeRegionAssignment.count({ where: { userId, regionId: { in: regionIds } } });
      if (inLedRegion === 0) throw new ApiError(403, 'FORBIDDEN', 'You can only edit employees in the regions you lead');
    }
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { role: true, _count: { select: { regionAssignments: true } } },
    });
    if (!existing) throw new ApiError(404, 'USER_NOT_FOUND', 'User not found');

    const data: { fullName?: string; phone?: string | null; passwordHash?: string; role?: UserRole } = {};
    if (request.body?.fullName !== undefined) data.fullName = text(request.body.fullName, 'Full name', 150);
    if (request.body?.phone !== undefined) data.phone = optionalPhone(request.body.phone);
    if (request.body?.password !== undefined) {
      data.passwordHash = await hashPassword(password(request.body.password));
    }
    if (request.body?.role !== undefined) {
      const role = request.body.role as UserRole;
      if (!Object.values(UserRole).includes(role)) {
        throw new ApiError(400, 'INVALID_ROLE', 'Choose a valid employee role');
      }
      if (role !== existing.role && existing._count.regionAssignments > 0) {
        throw new ApiError(409, 'ASSIGNMENTS_EXIST', 'Remove the user’s region assignments before changing their role');
      }
      if (role !== existing.role && (role === UserRole.DISTRICT_HEAD || existing.role === UserRole.DISTRICT_HEAD)) {
        throw new ApiError(400, 'INVALID_ROLE', 'The district head role cannot be changed');
      }
      data.role = role;
    }
    if (Object.keys(data).length === 0) {
      throw new ApiError(400, 'EMPTY_UPDATE', 'Provide at least one field to update');
    }

    const user = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({
        where: { id: userId },
        data,
        select: { id: true, username: true, fullName: true, phone: true, role: true },
      });
      if (data.passwordHash) await transaction.session.deleteMany({ where: { userId } });
      return updated;
    });
    response.json({ user });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.delete('/users/:userId', adminOnly, async (request, response, next) => {
  try {
    const userId = request.params.userId as string;
    if (userId === request.auth?.id) {
      throw new ApiError(409, 'CANNOT_DELETE_SELF', 'You cannot delete your own administrator account');
    }
    await prisma.user.delete({ where: { id: userId } });
    response.status(204).end();
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.get('/regions', async (request, response, next) => {
  try {
    const regionIds = await managedRegionIds(request);
    const regions = await prisma.region.findMany({
      where: regionIds ? { id: { in: regionIds } } : undefined,
      orderBy: { name: 'asc' },
      include: {
        _count: { select: { districts: true, employeeAssignments: true } },
        employeeAssignments: {
          orderBy: { user: { fullName: 'asc' } },
          include: { user: { select: { id: true, username: true, fullName: true, role: true } } },
        },
      },
    });
    response.json({ regions });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.post('/regions', adminOnly, async (request, response, next) => {
  try {
    const region = await prisma.region.create({ data: { id: randomUUID(), name: text(request.body?.name, 'Region name', 150) } });
    response.status(201).json({ region });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.patch('/regions/:regionId', adminOnly, async (request, response, next) => {
  try {
    const region = await prisma.region.update({
      where: { id: request.params.regionId as string },
      data: { name: text(request.body?.name, 'Region name', 150) },
    });
    response.json({ region });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.delete('/regions/:regionId', adminOnly, async (request, response, next) => {
  try {
    await prisma.region.delete({ where: { id: request.params.regionId as string } });
    response.status(204).end();
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.post('/regions/:regionId/assignments', async (request, response, next) => {
  try {
    const regionId = request.params.regionId as string;
    await requireRegionAccess(request, regionId);
    const userId = text(request.body?.userId, 'User', 100);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    if (!user || user.role === UserRole.ADMIN || user.role === UserRole.DISTRICT_HEAD) {
      throw new ApiError(400, 'INVALID_EMPLOYEE', 'Only employee accounts can be assigned to a region');
    }
    const assignment = await prisma.employeeRegionAssignment.create({ data: { userId, regionId } });
    response.status(201).json({ assignment });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

// Creates an employee account and assigns it to the region in one step (Administrators and the region's group leader).
router.post('/regions/:regionId/employees', async (request, response, next) => {
  try {
    const regionId = request.params.regionId as string;
    await requireRegionAccess(request, regionId);
    const role = request.body?.role;
    if (role !== UserRole.REPUBLIC_EMPLOYEE && role !== UserRole.REGIONAL_EMPLOYEE && role !== UserRole.VIEWER) {
      throw new ApiError(400, 'INVALID_ROLE', 'Choose Republic-level employee, regional employee or viewer');
    }
    const username = text(request.body?.username, 'Username', 100).toLowerCase();
    const fullName = text(request.body?.fullName, 'Full name', 150);
    const phone = optionalPhone(request.body?.phone);
    const passwordHash = await hashPassword(password(request.body?.password));

    const user = await prisma.user.create({
      data: { username, fullName, phone, passwordHash, role, regionAssignments: { create: { regionId } } },
      select: { id: true, username: true, fullName: true, phone: true, role: true },
    });
    response.status(201).json({ user });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.delete('/regions/:regionId/assignments/:assignmentId', async (request, response, next) => {
  try {
    const regionId = request.params.regionId as string;
    const assignmentId = request.params.assignmentId as string;
    await requireRegionAccess(request, regionId);
    const [region, districtUse] = await Promise.all([
      prisma.region.findUnique({ where: { id: regionId }, select: { groupLeaderAssignmentId: true } }),
      prisma.district.count({
        where: {
          regionId,
          OR: [
            { republicEmployeeAssignmentId: assignmentId },
            { regionalEmployeeAssignmentId: assignmentId },
          ],
        },
      }),
    ]);
    if (!region) throw new ApiError(404, 'REGION_NOT_FOUND', 'Region not found');
    if (region.groupLeaderAssignmentId === assignmentId || districtUse > 0) {
      throw new ApiError(409, 'ASSIGNMENT_IN_USE', 'Remove district assignments and group leader designation first');
    }
    await prisma.employeeRegionAssignment.delete({ where: { id: assignmentId, regionId } });
    response.status(204).end();
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.put('/regions/:regionId/group-leader', adminOnly, async (request, response, next) => {
  try {
    const regionId = request.params.regionId as string;
    const assignmentId = optionalId(request.body?.assignmentId, 'Group leader');
    if (assignmentId) {
      await requireEmployeeAssignment(assignmentId, regionId, UserRole.REPUBLIC_EMPLOYEE, 'Group leader');
    }
    const region = await prisma.region.update({ where: { id: regionId }, data: { groupLeaderAssignmentId: assignmentId } });
    response.json({ region });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

router.get('/districts', async (request, response, next) => {
  try {
    const regionId = typeof request.query.regionId === 'string' ? request.query.regionId : undefined;
    const regionIds = await managedRegionIds(request);
    const districts = await prisma.district.findMany({
      where: {
        AND: [
          regionId ? { regionId } : {},
          regionIds ? { regionId: { in: regionIds } } : {},
        ],
      },
      orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
      include: {
        region: { select: { id: true, name: true } },
        republicEmployeeAssignment: {
          include: { user: { select: { id: true, username: true, fullName: true, phone: true } } },
        },
        regionalEmployeeAssignment: {
          include: { user: { select: { id: true, username: true, fullName: true, phone: true } } },
        },
      },
    });
    response.json({ districts });
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

const countFields = ['engineerCount', 'xatlovEmployeeCount', 'objectCount', 'mfyCount'] as const;

async function saveDistrict(request: Request, response: Response, next: NextFunction, isCreate: boolean) {
  try {
    const current = isCreate
      ? null
      : await prisma.district.findUnique({ where: { id: request.params.districtId as string } });
    if (!isCreate && !current) throw new ApiError(404, 'DISTRICT_NOT_FOUND', 'District not found');
    const isLeader = current ? (await requireRegionAccess(request, current.regionId)) !== null : false;

    const body = request.body ?? {};
    const regionId = body.regionId === undefined && current ? current.regionId : text(body.regionId, 'Region', 100);
    const name = body.name === undefined && current ? current.name : text(body.name, 'District name', 150);
    if (isLeader && (regionId !== current!.regionId || name !== current!.name)) {
      throw new ApiError(403, 'FORBIDDEN', 'Group leaders cannot rename districts or move them to another region');
    }
    const counts = {} as Record<(typeof countFields)[number], number | null>;
    for (const field of countFields) {
      const value = body[field] === undefined && current ? current[field] : body[field];
      if (value !== null && value !== undefined && (!Number.isSafeInteger(value) || value < 0)) {
        throw new ApiError(400, 'INVALID_COUNT', `${field} must be a non-negative whole number`);
      }
      counts[field] = value ?? null;
    }

    const republicId = body.republicEmployeeAssignmentId === undefined && current
      ? current.republicEmployeeAssignmentId
      : optionalId(body.republicEmployeeAssignmentId, 'Republic-level assignment');
    const regionalId = body.regionalEmployeeAssignmentId === undefined && current
      ? current.regionalEmployeeAssignmentId
      : optionalId(body.regionalEmployeeAssignmentId, 'Regional assignment');
    if (republicId && regionalId && republicId === regionalId) {
      throw new ApiError(400, 'INVALID_ASSIGNMENT', 'Republic-level and regional assignments must be different');
    }

    await requireEmployeeAssignment(republicId, regionId, UserRole.REPUBLIC_EMPLOYEE, 'Republic-level assignment');
    await requireEmployeeAssignment(regionalId, regionId, UserRole.REGIONAL_EMPLOYEE, 'Regional assignment');

    const data = { name, regionId, ...counts, republicEmployeeAssignmentId: republicId, regionalEmployeeAssignmentId: regionalId };
    const district = isCreate
      ? await prisma.district.create({ data })
      : await prisma.district.update({ where: { id: current!.id }, data });
    response.status(isCreate ? 201 : 200).json({ district });
  } catch (error) {
    mapDatabaseError(error, next);
  }
}

router.post('/districts', adminOnly, (request, response, next) => saveDistrict(request, response, next, true));
router.patch('/districts/:districtId', (request, response, next) => saveDistrict(request, response, next, false));

router.delete('/districts/:districtId', adminOnly, async (request, response, next) => {
  try {
    await prisma.district.delete({ where: { id: request.params.districtId as string } });
    response.status(204).end();
  } catch (error) {
    mapDatabaseError(error, next);
  }
});

export const adminRouter = router;
