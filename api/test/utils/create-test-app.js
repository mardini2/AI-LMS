"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createTestApp = createTestApp;
exports.cleanDatabase = cleanDatabase;
const common_1 = require("@nestjs/common");
const testing_1 = require("@nestjs/testing");
const typeorm_1 = require("typeorm");
const app_module_1 = require("../../src/app.module");
async function createTestApp() {
    const moduleRef = await testing_1.Test.createTestingModule({
        imports: [app_module_1.AppModule],
    }).compile();
    const app = moduleRef.createNestApplication();
    app.useGlobalPipes(new common_1.ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
    }));
    await app.init();
    return app;
}
async function cleanDatabase(app) {
    const dataSource = app.get(typeorm_1.DataSource);
    await dataSource.query('TRUNCATE TABLE messages, conversations RESTART IDENTITY CASCADE');
}
//# sourceMappingURL=create-test-app.js.map