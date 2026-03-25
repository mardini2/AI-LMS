// goal: return 200 JSON so load balancers know the API process is up.

import { Controller, Get } from '@nestjs/common';

@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      service: 'syllentra-api',
      timestamp: new Date().toISOString(),
    };
  }
}
