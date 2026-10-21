import { createHash, randomBytes } from 'node:crypto';
import express, { type RequestHandler } from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { prisma } from './db.js';
import { verifyPassword } from './password.js';

interface AuthenticatedUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  allRegions: boolean;
  sessionId: string;
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthenticatedUser;
    }
  }
}

const router = express.Router();
const sessionHours = Number(process.env.SESSION_TTL_HOURS ?? 12);

if (!Number.isSafeInteger(sessionHours) || sessionHours < 1 || sessionHours > 720) {
  throw new Error('SESSION_TTL_HOURS must be an integer between 1 and 720');
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export const requireAuth: RequestHandler = async (request, _response, next) => {
  try {
    const authorization = request.get('authorization');
    const match = authorization?.match(/^Bearer ([\da-f]{64})$/i);
    if (!match) {
      throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue');
    }

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(match[1]) },
      include: {
        user: { select: { id: true, username: true, fullName: true, role: true, allRegions: true } },
      },
    });

    if (!session || session.expiresAt <= new Date()) {
      if (session) {
        await prisma.session.delete({ where: { id: session.id } });
      }
      throw new ApiError(401, 'UNAUTHENTICATED', 'Session is invalid or expired');
    }

    request.auth = { ...session.user, sessionId: session.id };
    next();
  } catch (error) {
    next(error);
  }
};

export function requireRole(...roles: UserRole[]): RequestHandler {
  return (request, _response, next) => {
    if (!request.auth) {
      next(new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue'));
    } else if (!roles.includes(request.auth.role)) {
      next(new ApiError(403, 'FORBIDDEN', 'You do not have permission to perform this action'));
    } else {
      next();
    }
  };
}

// Republic employees and viewers see every district in the regions they are assigned to (viewers with allRegions see every region);
// regional employees see only the districts they are assigned to as the regional representative.
export function readableDistrictScope(user: { id: string; role: UserRole; allRegions?: boolean }): Prisma.DistrictWhereInput {
  if (user.role === UserRole.ADMIN || (user.role === UserRole.VIEWER && user.allRegions)) return {};
  if (user.role === UserRole.REGIONAL_EMPLOYEE) return { regionalEmployeeAssignment: { is: { userId: user.id } } };
  return { region: { employeeAssignments: { some: { userId: user.id } } } };
}

// The report and dashboard also let a district head see their own district; other pages stay closed to them.
export function reportDistrictScope(user: { id: string; role: UserRole; allRegions?: boolean }): Prisma.DistrictWhereInput {
  if (user.role === UserRole.DISTRICT_HEAD) return { heads: { some: { id: user.id } } };
  return readableDistrictScope(user);
}

// Districts the user may add or edit records for, mirroring requireDistrictAccess('write'); null means every district.
export async function writableDistrictIds(user: { id: string; role: UserRole }, allowGroupLeader = false): Promise<string[] | null> {
  if (user.role === UserRole.ADMIN) return null;
  if (user.role !== UserRole.REPUBLIC_EMPLOYEE) return [];
  const districts = await prisma.district.findMany({
    where: {
      OR: [
        { republicEmployeeAssignment: { is: { userId: user.id } } },
        ...(allowGroupLeader ? [{ region: { groupLeaderAssignment: { is: { userId: user.id } } } }] : []),
      ],
    },
    select: { id: true },
  });
  return districts.map((district) => district.id);
}

// allowGroupLeader lets a Republic employee who leads the district's region access every district in it.
export function requireDistrictAccess(action: 'report' | 'write', allowGroupLeader = false): RequestHandler {
  return async (request, _response, next) => {
    try {
      if (!request.auth) {
        throw new ApiError(401, 'UNAUTHENTICATED', 'Sign in to continue');
      }

      const districtId = request.params.districtId;
      if (typeof districtId !== 'string' || districtId.length === 0) {
        throw new ApiError(400, 'INVALID_DISTRICT', 'A district ID is required');
      }

      const district = await prisma.district.findUnique({
        where: { id: districtId },
        select: {
          republicEmployeeAssignment: { select: { userId: true } },
          regionalEmployeeAssignment: { select: { userId: true } },
          region: {
            select: {
              groupLeaderAssignment: { select: { userId: true } },
              employeeAssignments: {
                where: { userId: request.auth.id },
                select: { id: true },
              },
            },
          },
        },
      });

      if (!district) {
        throw new ApiError(404, 'DISTRICT_NOT_FOUND', 'District not found');
      }

      const user = request.auth;
      const isAdministrator = user.role === UserRole.ADMIN;
      const isAssignedRepublicEmployee =
        user.role === UserRole.REPUBLIC_EMPLOYEE &&
        (district.republicEmployeeAssignment?.userId === user.id ||
          (allowGroupLeader && district.region.groupLeaderAssignment?.userId === user.id));
      const isRegionalEmployeeInRegion =
        (user.role === UserRole.REGIONAL_EMPLOYEE && district.regionalEmployeeAssignment?.userId === user.id) ||
        (user.role === UserRole.VIEWER && (user.allRegions || district.region.employeeAssignments.length > 0));
      const permitted =
        isAdministrator ||
        (action === 'write' && isAssignedRepublicEmployee) ||
        (action === 'report' && (isAssignedRepublicEmployee || isRegionalEmployeeInRegion));

      if (!permitted) {
        throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this district');
      }

      next();
    } catch (error) {
      next(error);
    }
  };
}

router.post('/login', async (request, response, next) => {
  try {
    const { username, password } = request.body ?? {};
    if (
      typeof username !== 'string' ||
      username.trim().length === 0 ||
      username.length > 100 ||
      typeof password !== 'string' ||
      password.length === 0 ||
      password.length > 200
    ) {
      throw new ApiError(400, 'INVALID_CREDENTIALS', 'Username and password are required');
    }

    const user = await prisma.user.findUnique({
      where: { username: username.trim().toLowerCase() },
      select: { id: true, username: true, fullName: true, role: true, passwordHash: true },
    });

    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      throw new ApiError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect');
    }

    const token = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + sessionHours * 60 * 60 * 1000);
    await prisma.session.create({
      data: { tokenHash: hashToken(token), userId: user.id, expiresAt },
    });

    response.setHeader('Cache-Control', 'no-store');
    response.json({
      token,
      expiresAt: expiresAt.toISOString(),
      user: { id: user.id, username: user.username, fullName: user.fullName, role: user.role },
    });
  } catch (error) {
    next(error);
  }
});

router.get('/me', requireAuth, async (request, response, next) => {
  try {
    const { id, username, fullName, role } = request.auth!;
    const ledRegions = await prisma.region.count({ where: { groupLeaderAssignment: { is: { userId: id } } } });
    response.json({ user: { id, username, fullName, role, isGroupLeader: ledRegions > 0 } });
  } catch (error) {
    next(error);
  }
});

router.post('/logout', requireAuth, async (request, response, next) => {
  try {
    await prisma.session.delete({ where: { id: request.auth!.sessionId } });
    response.status(204).end();
  } catch (error) {
    next(error);
  }
});

export const authRouter = router;
