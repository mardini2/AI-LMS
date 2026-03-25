// goal: ensure write() maps fields straight into prisma.auditLog.create.

import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  const prisma = {
    auditLog: {
      create: jest.fn(),
    },
  };

  let service: AuditLogService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AuditLogService(prisma as never);
  });

  it('writes expected audit payload', async () => {
    prisma.auditLog.create.mockResolvedValue({ id: 'x' });

    await service.write({
      actorId: 'u1',
      action: 'COURSE_CREATED',
      entityType: 'Course',
      entityId: 'c1',
      metadata: { key: 'value' },
    });

    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorId: 'u1',
        action: 'COURSE_CREATED',
        entityType: 'Course',
        entityId: 'c1',
        metadata: { key: 'value' },
      },
    });
  });
});
