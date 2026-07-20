import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddQuestListing1784178000000 implements MigrationInterface {
  name = 'AddQuestListing1784178000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE quests
      ADD COLUMN retry_allowed boolean NOT NULL DEFAULT true
    `)

    await queryRunner.query(`
      CREATE INDEX ix_quest_attempts_user_quest_latest
        ON quest_attempts (user_id, quest_id, started_at DESC, id DESC)
    `)

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION assert_published_quest_valid(
        checked_quest_id uuid
      ) RETURNS void AS $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM quests
          WHERE id = checked_quest_id AND status = 'PUBLISHED'
        ) THEN
          RETURN;
        END IF;

        IF NOT EXISTS (
          SELECT 1 FROM quest_questions WHERE quest_id = checked_quest_id
        ) THEN
          RAISE EXCEPTION 'Published quest must contain at least one question'
            USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
          SELECT 1
          FROM quest_questions question
          WHERE question.quest_id = checked_quest_id
            AND (
              (SELECT count(*) FROM quest_options option
               WHERE option.question_id = question.id) < 2
              OR
              (SELECT count(*) FROM quest_options option
               WHERE option.question_id = question.id
                 AND option.is_correct = true) <> 1
            )
        ) THEN
          RAISE EXCEPTION 'Published quest questions require at least two options and exactly one correct option'
            USING ERRCODE = '23514';
        END IF;
      END;
      $$ LANGUAGE plpgsql
    `)

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_published_quest_trigger()
      RETURNS trigger AS $$
      DECLARE
        checked_quest_id uuid;
        previous_quest_id uuid;
      BEGIN
        IF TG_TABLE_NAME = 'quests' THEN
          IF TG_OP = 'DELETE' THEN
            checked_quest_id := OLD.id;
          ELSE
            checked_quest_id := NEW.id;
          END IF;
        ELSIF TG_TABLE_NAME = 'quest_questions' THEN
          IF TG_OP = 'DELETE' THEN
            checked_quest_id := OLD.quest_id;
          ELSE
            checked_quest_id := NEW.quest_id;
          END IF;
          IF TG_OP = 'UPDATE' THEN
            previous_quest_id := OLD.quest_id;
          END IF;
        ELSE
          IF TG_OP <> 'DELETE' THEN
            SELECT quest_id INTO checked_quest_id
            FROM quest_questions
            WHERE id = NEW.question_id;
          END IF;
          IF TG_OP <> 'INSERT' THEN
            SELECT quest_id INTO previous_quest_id
            FROM quest_questions
            WHERE id = OLD.question_id;
            checked_quest_id := COALESCE(checked_quest_id, previous_quest_id);
          END IF;
        END IF;

        IF checked_quest_id IS NOT NULL THEN
          PERFORM assert_published_quest_valid(checked_quest_id);
        END IF;
        IF previous_quest_id IS NOT NULL
          AND previous_quest_id IS DISTINCT FROM checked_quest_id THEN
          PERFORM assert_published_quest_valid(previous_quest_id);
        END IF;
        RETURN NULL;
      END;
      $$ LANGUAGE plpgsql
    `)

    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER trg_validate_published_quest
      AFTER INSERT OR UPDATE ON quests
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_published_quest_trigger()
    `)

    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER trg_validate_published_quest_question
      AFTER INSERT OR UPDATE OR DELETE ON quest_questions
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_published_quest_trigger()
    `)

    await queryRunner.query(`
      CREATE CONSTRAINT TRIGGER trg_validate_published_quest_option
      AFTER INSERT OR UPDATE OR DELETE ON quest_options
      DEFERRABLE INITIALLY DEFERRED
      FOR EACH ROW EXECUTE FUNCTION validate_published_quest_trigger()
    `)

    await queryRunner.query(`
      DO $$
      DECLARE published_quest record;
      BEGIN
        FOR published_quest IN SELECT id FROM quests WHERE status = 'PUBLISHED'
        LOOP
          PERFORM assert_published_quest_valid(published_quest.id);
        END LOOP;
      END $$
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS trg_validate_published_quest_option ON quest_options',
    )
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS trg_validate_published_quest_question ON quest_questions',
    )
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS trg_validate_published_quest ON quests',
    )
    await queryRunner.query('DROP FUNCTION IF EXISTS validate_published_quest_trigger')
    await queryRunner.query('DROP FUNCTION IF EXISTS assert_published_quest_valid')
    await queryRunner.query('DROP INDEX IF EXISTS ix_quest_attempts_user_quest_latest')
    await queryRunner.query('ALTER TABLE quests DROP COLUMN IF EXISTS retry_allowed')
  }
}
