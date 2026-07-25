import type { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRagStorage1784959200000 implements MigrationInterface {
  name = 'AddRagStorage1784959200000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE messages ADD COLUMN IF NOT EXISTS embedding jsonb',
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS course_context_chunks (
        id uuid PRIMARY KEY DEFAULT (md5(random()::text || clock_timestamp()::text)::uuid),
        course_id integer NOT NULL,
        fingerprint varchar(64) NOT NULL,
        text text NOT NULL,
        metadata jsonb NOT NULL,
        embedding jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_course_context_chunks_fingerprint
      ON course_context_chunks (course_id, fingerprint)
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_course_context_chunks_course
      ON course_context_chunks (course_id)
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_course_context_chunks_course',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS idx_course_context_chunks_fingerprint',
    );
    await queryRunner.query('DROP TABLE IF EXISTS course_context_chunks');
    await queryRunner.query(
      'ALTER TABLE messages DROP COLUMN IF EXISTS embedding',
    );
  }
}
