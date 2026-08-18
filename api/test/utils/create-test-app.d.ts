import { INestApplication } from '@nestjs/common';
export declare function createTestApp(): Promise<INestApplication>;
export declare function cleanDatabase(app: INestApplication): Promise<void>;
