// goal: enforce @Roles() metadata after JWT auth by checking request.user.role.

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { Role } from '../enums/role.enum';
import { AuthenticatedRequest } from '../types/authenticated-request.type';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // no @Roles on this handler → open to any authenticated user (if JWT guard ran)
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    if (!request.user?.role) {
      throw new ForbiddenException('Missing user role');
    }

    const allowed = requiredRoles.includes(request.user.role as Role);

    if (!allowed) {
      throw new ForbiddenException('You do not have enough permissions');
    }

    return true;
  }
}
