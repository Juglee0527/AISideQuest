import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddQuestAttemptFlow1784181600000 implements MigrationInterface {
  name = 'AddQuestAttemptFlow1784181600000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE api_idempotency_keys
      DROP CONSTRAINT ck_api_idempotency_keys_operation,
      ADD CONSTRAINT ck_api_idempotency_keys_operation CHECK (
        operation IN (
          'SESSION_MANUAL_START',
          'SESSION_END',
          'DEVICE_LINK_CREATE',
          'DEVICE_ROTATION_LINK_CREATE',
          'DEVICE_LINK_REDEEM',
          'DEVICE_REVOKE',
          'QUEST_ATTEMPT_START',
          'QUEST_ATTEMPT_SUBMIT'
        )
      )
    `)

    await queryRunner.query(`
      ALTER TABLE quest_attempt_answers
      ALTER COLUMN is_correct DROP NOT NULL
    `)

    await queryRunner.query(`
      ALTER TABLE quest_attempts
      DROP CONSTRAINT ck_quest_attempts_status,
      DROP CONSTRAINT ck_quest_attempts_completion_time,
      DROP CONSTRAINT ck_quest_attempts_result,
      ADD CONSTRAINT ck_quest_attempts_status CHECK (
        status IN ('IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'FAILED', 'EXPIRED')
      ),
      ADD CONSTRAINT ck_quest_attempts_completion_time CHECK (
        completed_at IS NULL
        OR (
          status = 'EXPIRED'
          AND submitted_at IS NULL
          AND completed_at >= started_at
        )
        OR (
          submitted_at IS NOT NULL
          AND completed_at >= submitted_at
        )
      ),
      ADD CONSTRAINT ck_quest_attempts_result CHECK (
        (
          status = 'IN_PROGRESS'
          AND submitted_at IS NULL
          AND completed_at IS NULL
          AND score IS NULL
          AND passed IS NULL
          AND reward_points_snapshot IS NULL
        )
        OR (
          status = 'SUBMITTED'
          AND submitted_at IS NOT NULL
          AND completed_at IS NULL
          AND score IS NULL
          AND passed IS NULL
          AND reward_points_snapshot IS NULL
        )
        OR (
          status IN ('COMPLETED', 'FAILED')
          AND submitted_at IS NOT NULL
          AND completed_at IS NOT NULL
          AND score IS NOT NULL
          AND passed IS NOT NULL
          AND reward_points_snapshot IS NOT NULL
          AND (
            (status = 'COMPLETED' AND passed = true)
            OR (status = 'FAILED' AND passed = false)
          )
        )
        OR (
          status = 'EXPIRED'
          AND submitted_at IS NULL
          AND completed_at IS NOT NULL
          AND score IS NULL
          AND passed IS NULL
          AND reward_points_snapshot IS NULL
        )
      )
    `)

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION prevent_published_quest_content_change()
      RETURNS trigger AS $$
      BEGIN
        IF TG_TABLE_NAME = 'quests' THEN
          IF OLD.status = 'PUBLISHED' AND (
            NEW.code IS DISTINCT FROM OLD.code
            OR NEW.version IS DISTINCT FROM OLD.version
            OR NEW.type IS DISTINCT FROM OLD.type
            OR NEW.title IS DISTINCT FROM OLD.title
            OR NEW.description IS DISTINCT FROM OLD.description
            OR NEW.estimated_minutes IS DISTINCT FROM OLD.estimated_minutes
            OR NEW.reward_points IS DISTINCT FROM OLD.reward_points
            OR NEW.pass_score IS DISTINCT FROM OLD.pass_score
            OR NEW.retry_allowed IS DISTINCT FROM OLD.retry_allowed
            OR NEW.published_at IS DISTINCT FROM OLD.published_at
          ) THEN
            RAISE EXCEPTION 'Published quest content is immutable; publish a new version'
              USING ERRCODE = '23514';
          END IF;
          RETURN NEW;
        END IF;

        IF TG_TABLE_NAME = 'quest_questions' THEN
          IF TG_OP <> 'INSERT' AND EXISTS (
            SELECT 1 FROM quests
            WHERE id = OLD.quest_id AND status = 'PUBLISHED'
          ) THEN
            RAISE EXCEPTION 'Published quest content is immutable; publish a new version'
              USING ERRCODE = '23514';
          END IF;
          IF TG_OP <> 'DELETE' AND EXISTS (
            SELECT 1 FROM quests
            WHERE id = NEW.quest_id AND status = 'PUBLISHED'
          ) THEN
            RAISE EXCEPTION 'Published quest content is immutable; publish a new version'
              USING ERRCODE = '23514';
          END IF;
        ELSE
          IF TG_OP <> 'INSERT' AND EXISTS (
            SELECT 1
            FROM quest_questions question
            JOIN quests quest ON quest.id = question.quest_id
            WHERE question.id = OLD.question_id AND quest.status = 'PUBLISHED'
          ) THEN
            RAISE EXCEPTION 'Published quest content is immutable; publish a new version'
              USING ERRCODE = '23514';
          END IF;
          IF TG_OP <> 'DELETE' AND EXISTS (
            SELECT 1
            FROM quest_questions question
            JOIN quests quest ON quest.id = question.quest_id
            WHERE question.id = NEW.question_id AND quest.status = 'PUBLISHED'
          ) THEN
            RAISE EXCEPTION 'Published quest content is immutable; publish a new version'
              USING ERRCODE = '23514';
          END IF;
        END IF;

        IF TG_OP = 'DELETE' THEN
          RETURN OLD;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `)

    await queryRunner.query(`
      CREATE TRIGGER trg_prevent_published_quest_change
      BEFORE UPDATE ON quests
      FOR EACH ROW EXECUTE FUNCTION prevent_published_quest_content_change()
    `)
    await queryRunner.query(`
      CREATE TRIGGER trg_prevent_published_question_change
      BEFORE INSERT OR UPDATE OR DELETE ON quest_questions
      FOR EACH ROW EXECUTE FUNCTION prevent_published_quest_content_change()
    `)
    await queryRunner.query(`
      CREATE TRIGGER trg_prevent_published_option_change
      BEFORE INSERT OR UPDATE OR DELETE ON quest_options
      FOR EACH ROW EXECUTE FUNCTION prevent_published_quest_content_change()
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS trg_prevent_published_option_change ON quest_options',
    )
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS trg_prevent_published_question_change ON quest_questions',
    )
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS trg_prevent_published_quest_change ON quests',
    )
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS prevent_published_quest_content_change',
    )

    await queryRunner.query(`
      ALTER TABLE quest_attempts
      DROP CONSTRAINT ck_quest_attempts_status,
      DROP CONSTRAINT ck_quest_attempts_completion_time,
      DROP CONSTRAINT ck_quest_attempts_result,
      ADD CONSTRAINT ck_quest_attempts_status CHECK (
        status IN ('IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'FAILED')
      ),
      ADD CONSTRAINT ck_quest_attempts_completion_time CHECK (
        completed_at IS NULL
        OR (submitted_at IS NOT NULL AND completed_at >= submitted_at)
      ),
      ADD CONSTRAINT ck_quest_attempts_result CHECK (
        (
          status = 'IN_PROGRESS'
          AND submitted_at IS NULL
          AND completed_at IS NULL
          AND score IS NULL
          AND passed IS NULL
          AND reward_points_snapshot IS NULL
        )
        OR (
          status = 'SUBMITTED'
          AND submitted_at IS NOT NULL
          AND completed_at IS NULL
          AND score IS NULL
          AND passed IS NULL
          AND reward_points_snapshot IS NULL
        )
        OR (
          status IN ('COMPLETED', 'FAILED')
          AND submitted_at IS NOT NULL
          AND completed_at IS NOT NULL
          AND score IS NOT NULL
          AND passed IS NOT NULL
          AND reward_points_snapshot IS NOT NULL
          AND (
            (status = 'COMPLETED' AND passed = true)
            OR (status = 'FAILED' AND passed = false)
          )
        )
      )
    `)

    await queryRunner.query(`
      ALTER TABLE quest_attempt_answers
      ALTER COLUMN is_correct SET NOT NULL
    `)

    await queryRunner.query(`
      ALTER TABLE api_idempotency_keys
      DROP CONSTRAINT ck_api_idempotency_keys_operation,
      ADD CONSTRAINT ck_api_idempotency_keys_operation CHECK (
        operation IN (
          'SESSION_MANUAL_START',
          'SESSION_END',
          'DEVICE_LINK_CREATE',
          'DEVICE_ROTATION_LINK_CREATE',
          'DEVICE_LINK_REDEEM',
          'DEVICE_REVOKE'
        )
      )
    `)
  }
}
