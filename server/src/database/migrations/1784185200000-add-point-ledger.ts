import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddPointLedger1784185200000 implements MigrationInterface {
  name = 'AddPointLedger1784185200000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO point_ledger (
        user_id, quest_id, quest_attempt_id,
        entry_type, points, description, created_at
      )
      SELECT attempt.user_id,
             attempt.quest_id,
             attempt.id,
             'QUEST_REWARD',
             attempt.reward_points_snapshot,
             'First pass reward for ' || quest.code || ' v' || quest.version,
             attempt.completed_at
      FROM quest_attempts attempt
      JOIN quests quest ON quest.id = attempt.quest_id
      WHERE attempt.status = 'COMPLETED'
        AND attempt.passed = true
        AND attempt.reward_points_snapshot = 100
      ON CONFLICT DO NOTHING
    `)

    await queryRunner.query('DROP INDEX ix_point_ledger_user_created')
    await queryRunner.query(`
      CREATE INDEX ix_point_ledger_user_created
      ON point_ledger (user_id, created_at DESC, id DESC)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX ix_point_ledger_user_created')
    await queryRunner.query(`
      CREATE INDEX ix_point_ledger_user_created
      ON point_ledger (user_id, created_at DESC)
    `)
  }
}
