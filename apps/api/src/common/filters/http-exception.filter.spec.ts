// goal: assert 500 responses hide details while 4xx pass validation messages through.

import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const filter = new HttpExceptionFilter();

  beforeEach(() => {
    (filter as unknown as { logger: { error: jest.Mock } }).logger = {
      error: jest.fn(),
    };
  });

  // minimal Express response chain: status().json()
  const createHost = () => {
    const json = jest.fn();
    const status = jest.fn().mockReturnValue({ json });
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status }),
        getRequest: () => ({ url: '/x' }),
      }),
    } as unknown as ArgumentsHost;

    return { host, status, json };
  };

  it('returns generic payload for non-HttpException errors', () => {
    const { host, status, json } = createHost();

    filter.catch(new Error('sensitive detail'), host);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        path: '/x',
        message: 'Internal server error',
      }),
    );
  });

  it('returns http exception response fields for 4xx errors', () => {
    const { host, status, json } = createHost();

    filter.catch(
      new BadRequestException({ message: 'Invalid input', code: 'BAD_INPUT' }),
      host,
    );

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        path: '/x',
        message: 'Invalid input',
        code: 'BAD_INPUT',
      }),
    );
  });
});
