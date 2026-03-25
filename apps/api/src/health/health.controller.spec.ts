// goal: lock down the health JSON contract for monitors.

import { HealthController } from './health.controller';

describe('HealthController', () => {
  it('returns healthy service payload', () => {
    const controller = new HealthController();

    const result = controller.check();

    expect(result.status).toBe('ok');
    expect(result.service).toBe('syllentra-api');
    expect(result.timestamp).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });
});
