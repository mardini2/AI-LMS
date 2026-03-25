// goal: unit-test AuthController wiring to AuthService without booting Nest.

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';

describe('AuthController', () => {
  // narrow mock: only methods the controller calls
  const authService = {
    login: jest.fn(),
    me: jest.fn(),
  } as unknown as AuthService;

  let controller: AuthController;

  beforeEach(() => {
    jest.clearAllMocks();
    controller = new AuthController(authService);
  });

  it('delegates login with dto email/password', async () => {
    (authService.login as jest.Mock).mockResolvedValue({ accessToken: 't' });

    await expect(
      controller.login({ email: 'user@example.com', password: 'pw' }),
    ).resolves.toEqual({ accessToken: 't' });
    expect(authService.login).toHaveBeenCalledWith('user@example.com', 'pw');
  });

  it('delegates me with request user id', async () => {
    (authService.me as jest.Mock).mockResolvedValue({ id: 'u1' });

    await expect(
      controller.me({ user: { sub: 'u1' } } as never),
    ).resolves.toEqual({
      id: 'u1',
    });
    expect(authService.me).toHaveBeenCalledWith('u1');
  });
});
