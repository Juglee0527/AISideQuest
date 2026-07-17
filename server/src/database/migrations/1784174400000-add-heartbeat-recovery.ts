import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddHeartbeatRecovery1784174400000
  implements MigrationInterface
{
  name = 'AddHeartbeatRecovery1784174400000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE integration_events
      ADD COLUMN sequence bigint,
      ADD CONSTRAINT ck_integration_events_sequence CHECK (
        sequence IS NULL OR sequence > 0
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX uk_integration_events_device_sequence
        ON integration_events (device_id, sequence)
        WHERE sequence IS NOT NULL
    `)

    await queryRunner.query(`
      CREATE INDEX ix_ai_sessions_manual_expiration
        ON ai_sessions (started_at)
        WHERE status IN ('RUNNING', 'WAITING_FOR_USER')
          AND external_turn_key IS NULL
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS ix_ai_sessions_manual_expiration',
    )
    await queryRunner.query(
      'DROP INDEX IF EXISTS uk_integration_events_device_sequence',
    )
    await queryRunner.query(`
      ALTER TABLE integration_events
      DROP CONSTRAINT IF EXISTS ck_integration_events_sequence,
      DROP COLUMN IF EXISTS sequence
    `)
  }
}
