import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddOperationalDiagnostics1784196000000 implements MigrationInterface {
  name = 'AddOperationalDiagnostics1784196000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE devices
      ADD COLUMN queue_depth integer NOT NULL DEFAULT 0,
      ADD COLUMN queue_oldest_age_seconds integer NOT NULL DEFAULT 0,
      ADD COLUMN dead_letter_count integer NOT NULL DEFAULT 0,
      ADD COLUMN diagnostics_reported_at timestamptz,
      ADD CONSTRAINT ck_devices_queue_depth CHECK (queue_depth BETWEEN 0 AND 10000),
      ADD CONSTRAINT ck_devices_queue_oldest_age CHECK (queue_oldest_age_seconds BETWEEN 0 AND 86400),
      ADD CONSTRAINT ck_devices_dead_letter_count CHECK (dead_letter_count BETWEEN 0 AND 10000)
    `)
    await queryRunner.query(`
      CREATE INDEX ix_devices_diagnostics_recent
      ON devices (diagnostics_reported_at DESC)
      WHERE diagnostics_reported_at IS NOT NULL
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS ix_devices_diagnostics_recent')
    await queryRunner.query(`
      ALTER TABLE devices
      DROP CONSTRAINT ck_devices_dead_letter_count,
      DROP CONSTRAINT ck_devices_queue_oldest_age,
      DROP CONSTRAINT ck_devices_queue_depth,
      DROP COLUMN diagnostics_reported_at,
      DROP COLUMN dead_letter_count,
      DROP COLUMN queue_oldest_age_seconds,
      DROP COLUMN queue_depth
    `)
  }
}
