// goal: test RolesGuard with fake ExecutionContext and Reflector metadata.

import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../enums/role.enum';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const reflector = {
    getAllAndOverride: jest.fn(),
  } as unknown as Reflector;

  let guard: RolesGuard;

  const createContext = (role?: string): ExecutionContext =>
    ({
      getHandler: jest.fn(),
      getClass: jest.fn(),
      switchToHttp: () => ({
        getRequest: () => ({
          user: role ? { role } : undefined,
        }),
      }),
    }) as unknown as ExecutionContext;

  beforeEach(() => {
    jest.clearAllMocks();
    guard = new RolesGuard(reflector);
  });

  it('allows request when no roles are required', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue(undefined);

    expect(guard.canActivate(createContext(Role.ADMIN))).toBe(true);
  });

  it('throws when required roles exist but request has no role', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([Role.ADMIN]);

    expect(() => guard.canActivate(createContext())).toThrow(
      new ForbiddenException('Missing user role'),
    );
  });

  it('throws when user role does not match', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([Role.ADMIN]);

    expect(() => guard.canActivate(createContext(Role.STUDENT))).toThrow(
      new ForbiddenException('You do not have enough permissions'),
    );
  });

  it('allows request when user role matches required roles', () => {
    (reflector.getAllAndOverride as jest.Mock).mockReturnValue([
      Role.ADMIN,
      Role.INSTRUCTOR,
    ]);

    expect(guard.canActivate(createContext(Role.INSTRUCTOR))).toBe(true);
  });
});
