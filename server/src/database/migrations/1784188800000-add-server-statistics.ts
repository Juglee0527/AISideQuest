import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddServerStatistics1784188800000 implements MigrationInterface {
  name = 'AddServerStatistics1784188800000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE users
      ALTER COLUMN time_zone SET DEFAULT 'UTC',
      ADD COLUMN time_zone_verified boolean NOT NULL DEFAULT false
    `)
    await queryRunner.query(`
      UPDATE users
      SET time_zone = 'UTC',
          time_zone_verified = false,
          updated_at = now()
    `)
    await queryRunner.query(`
      CREATE INDEX ix_ai_sessions_user_interval
      ON ai_sessions (user_id, started_at, ended_at)
      INCLUDE (timing_quality, status)
    `)
    await queryRunner.query(`
      CREATE INDEX ix_quest_attempts_user_completed_passed
      ON quest_attempts (user_id, completed_at DESC, id DESC)
      WHERE status = 'COMPLETED' AND passed = true
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX ix_quest_attempts_user_completed_passed')
    await queryRunner.query('DROP INDEX ix_ai_sessions_user_interval')
    await queryRunner.query(`
      ALTER TABLE users
      DROP COLUMN time_zone_verified,
      ALTER COLUMN time_zone SET DEFAULT 'Asia/Seoul'
    `)
  }
}
