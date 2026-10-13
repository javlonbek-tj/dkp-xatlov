import express from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { requireAuth, requireRole } from './auth.js';
import { prisma } from './db.js';

const router = express.Router();
const assignmentInclude = { include: { user: { select: { fullName: true, phone: true } } } };

// Read-only overview of district representatives. Republic employees see only the regions they are assigned to.
router.get('/', requireAuth, requireRole(UserRole.ADMIN, UserRole.REPUBLIC_EMPLOYEE), async (request, response, next) => {
  try {
    const user = request.auth!;
    const regionWhere: Prisma.RegionWhereInput = user.role === UserRole.ADMIN ? {} : { employeeAssignments: { some: { userId: user.id } } };
    const [regions, districts] = await Promise.all([
      prisma.region.findMany({ where: regionWhere, orderBy: { name: 'asc' }, select: { id: true, name: true, groupLeaderAssignmentId: true } }),
      prisma.district.findMany({
        where: { region: regionWhere },
        orderBy: [{ region: { name: 'asc' } }, { name: 'asc' }],
        select: {
          id: true, name: true, regionId: true,
          republicEmployeeAssignment: assignmentInclude,
          regionalEmployeeAssignment: assignmentInclude,
        },
      }),
    ]);
    response.json({ regions, districts });
  } catch (error) { next(error); }
});

export const assignmentsRouter = router;
