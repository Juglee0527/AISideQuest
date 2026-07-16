import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddSessionRecoveryIndex1784257200000
implements MigrationInterface {
  name = 'AddSessionRecoveryIndex1784257200000'

  async up(queryRunner: QueryRunner): Promise<void> {
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
  }
}
