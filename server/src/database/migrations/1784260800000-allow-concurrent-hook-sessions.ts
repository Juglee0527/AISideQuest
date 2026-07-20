import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AllowConcurrentHookSessions1784260800000
  implements MigrationInterface
{
  name = 'AllowConcurrentHookSessions1784260800000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX IF EXISTS uk_ai_sessions_active_user')

    await queryRunner.query(`
      CREATE UNIQUE INDEX uk_ai_sessions_active_manual_user
        ON ai_sessions (user_id)
        WHERE origin = 'MANUAL'
          AND status IN ('RUNNING', 'WAITING_FOR_USER')
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX uk_ai_sessions_active_external_session
        ON ai_sessions (user_id, provider, external_session_key)
        WHERE external_session_key IS NOT NULL
          AND status IN ('RUNNING', 'WAITING_FOR_USER')
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP INDEX IF EXISTS uk_ai_sessions_active_external_session',
    )
    await queryRunner.query(
      'DROP INDEX IF EXISTS uk_ai_sessions_active_manual_user',
    )

    await queryRunner.query(`
      CREATE UNIQUE INDEX uk_ai_sessions_active_user
        ON ai_sessions (user_id)
        WHERE status IN ('RUNNING', 'WAITING_FOR_USER')
    `)
  }
}
