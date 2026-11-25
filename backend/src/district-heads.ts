import express, { type NextFunction, type Request } from 'express';
import { Prisma, UserRole } from '@prisma/client';
import { ApiError } from './api-error.js';
import { readableDistrictScope, requireAuth, requireRole } from './auth.js';
import { prisma } from './db.js';
import { hashPassword } from './password.js';

// District head accounts are created and managed by Administrators and the Republic employees of the region.
const router = express.Router();
router.use(requireAuth, requireRole(UserRole.ADMIN, UserRole.REPUBLIC_EMPLOYEE));
const headSelect = {
  id: true, username: true, fullName: true, phone: true,
  district: { select: { id: true, name: true, regionId: true, region: { select: { id: true, name: true } } } },
} satisfies Prisma.UserSelect;

function text(value: unknown, field: string, maxLength: number): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
    throw new ApiError(400, 'INVALID_INPUT', `${field} is required and must be at most ${maxLength} characters`);
  }
  return value.trim();
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

async function requireDistrict(request: Request, districtId: unknown) {
  if (typeof districtId !== 'string' || (await prisma.district.count({ where: { id: districtId, ...readableDistrictScope(request.auth!) } })) === 0) {
    throw new ApiError(403, 'FORBIDDEN', 'You do not have permission to access this district');
  }
  return districtId;
}

// The head must be in a district the user may manage.
async function requireHead(request: Request) {
  const userId = request.params.userId as string;
  const head = await prisma.user.findUnique({ where: { id: userId }, select: { role: true, districtId: true } });
  if (!head || head.role !== UserRole.DISTRICT_HEAD) throw new ApiError(404, 'USER_NOT_FOUND', 'District head not found');
  await requireDistrict(request, head.districtId);
  return userId;
}

function mapDatabaseError(error: unknown, next: NextFunction): void {
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
    next(new ApiError(409, 'DUPLICATE_RECORD', 'Bu login band'));
    return;
  }
  next(error);
}

router.get('/', async (request, response, next) => {
  try {
    const heads = await prisma.user.findMany({
      where: { role: UserRole.DISTRICT_HEAD, district: readableDistrictScope(request.auth!) },
      select: headSelect,
      orderBy: [{ district: { region: { name: 'asc' } } }, { district: { name: 'asc' } }, { fullName: 'asc' }],
    });
    response.json({ heads });
  } catch (error) { next(error); }
});

router.post('/', async (request, response, next) => {
  try {
    const districtId = await requireDistrict(request, request.body?.districtId);
    const user = await prisma.user.create({
      data: {
        username: text(request.body?.username, 'Username', 100).toLowerCase(),
        fullName: text(request.body?.fullName, 'Full name', 150),
        phone: optionalPhone(request.body?.phone),
        passwordHash: await hashPassword(password(request.body?.password)),
        role: UserRole.DISTRICT_HEAD,
        districtId,
      },
      select: headSelect,
    });
    response.status(201).json({ user });
  } catch (error) { mapDatabaseError(error, next); }
});

router.patch('/:userId', async (request, response, next) => {
  try {
    const userId = await requireHead(request);
    const data: Prisma.UserUncheckedUpdateInput = {
      fullName: text(request.body?.fullName, 'Full name', 150),
      phone: optionalPhone(request.body?.phone),
      districtId: await requireDistrict(request, request.body?.districtId),
    };
    const newPassword = request.body?.password === undefined ? null : password(request.body.password);
    if (newPassword) data.passwordHash = await hashPassword(newPassword);
    const user = await prisma.$transaction(async (transaction) => {
      const updated = await transaction.user.update({ where: { id: userId }, data, select: headSelect });
      if (newPassword) await transaction.session.deleteMany({ where: { userId } });
      return updated;
    });
    response.json({ user });
  } catch (error) { mapDatabaseError(error, next); }
});

router.delete('/:userId', async (request, response, next) => {
  try {
    const userId = await requireHead(request);
    await prisma.user.delete({ where: { id: userId } });
    response.status(204).end();
  } catch (error) { next(error); }
});

export const districtHeadsRouter = router;
