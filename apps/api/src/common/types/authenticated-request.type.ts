// goal: narrow Express Request after JwtStrategy runs so handlers get typed user.

import { Request } from 'express';

export interface AuthenticatedUser {
  sub: string;
  email: string;
  role: string;
  fullName: string;
}

export interface AuthenticatedRequest extends Request {
  user: AuthenticatedUser;
}
