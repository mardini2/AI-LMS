// goal: verify JwtStrategy.validate reloads the user and rejects missing rows.

import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy', () => {
  const configService = {
    getOrThrow: jest.fn().mockReturnValue('secret'),
  } as unknown as ConfigService;
  const prisma = {
    user: {
      findUnique: jest.fn(),
    },
  };

  let strategy: JwtStrategy;

  beforeEach(() => {
    jest.clearAllMocks();
    strategy = new JwtStrategy(configService, prisma as never);
  });

  it('throws when token points to deleted user', async () => {
    prisma.user.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({
        sub: 'u1',
        email: 'x@example.com',
        role: 'ADMIN',
        fullName: 'X',
      }),
    ).rejects.toThrow(new UnauthorizedException('Invalid user session'));
  });

  it('returns normalized auth user for valid session', async () => {
    prisma.user.findUnique.mockResolvedValue({
      id: 'u1',
      email: 'x@example.com',
      role: 'STUDENT',
      fullName: 'X',
    });

    // payload email/role may be stale; DB wins
    await expect(
      strategy.validate({
        sub: 'u1',
        email: 'ignored@example.com',
        role: 'ADMIN',
        fullName: 'Ignored',
      }),
    ).resolves.toEqual({
      sub: 'u1',
      email: 'x@example.com',
      role: 'STUDENT',
      fullName: 'X',
    });
  });
});
