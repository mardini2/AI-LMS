// goal: share one Prisma client for the whole Nest app and connect on startup.

import { Injectable, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    // open DB pool before any request hits controllers
    await this.$connect();
  }
}
