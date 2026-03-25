// goal: test login and me() branches with mocked Prisma and JWT.

import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { compare } from 'bcrypt';
import { AuthService } from './auth.service';

// isolate password compare so tests control true/false without real hashes
jest.mock('bcrypt', () => ({
  compare: jest.fn(),
}));

describe('AuthService', () => {
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };
  const jwtService = {
    signAsync: jest.fn(),
  } as unknown as JwtService;

  let service: AuthService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuthService(prisma as never, jwtService);
  });

  it('throws UnauthorizedException when user is not found', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.login('x@example.com', 'secret')).rejects.toThrow(
      new UnauthorizedException('Invalid email or password'),
    );
  });

  it('throws UnauthorizedException when password is invalid', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'x@example.com',
      role: 'ADMIN',
      fullName: 'X',
      passwordHash: 'hash',
    });
    (compare as jest.Mock).mockResolvedValue(false);

    await expect(service.login('x@example.com', 'wrong')).rejects.toThrow(
      new UnauthorizedException('Invalid email or password'),
    );
  });

  it('returns access token and normalized user payload on successful login', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'x@example.com',
      role: 'INSTRUCTOR',
      fullName: 'X',
      passwordHash: 'hash',
    });
    (compare as jest.Mock).mockResolvedValue(true);
    (jwtService.signAsync as jest.Mock).mockResolvedValue('jwt-token');

    await expect(service.login('x@example.com', 'ok')).resolves.toEqual({
      accessToken: 'jwt-token',
      user: {
        sub: 'u1',
        email: 'x@example.com',
        role: 'INSTRUCTOR',
        fullName: 'X',
      },
    });
  });

  it('throws when me() user does not exist', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(service.me('missing')).rejects.toThrow(
      new UnauthorizedException('User not found'),
    );
  });

  it('returns profile fields from me()', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'x@example.com',
      fullName: 'X',
      role: 'REVIEWER',
    });

    await expect(service.me('u1')).resolves.toEqual({
      id: 'u1',
      email: 'x@example.com',
      fullName: 'X',
      role: 'REVIEWER',
    });
  });
});
