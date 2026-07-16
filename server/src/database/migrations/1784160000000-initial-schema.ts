import type { MigrationInterface, QueryRunner } from 'typeorm'

export class InitialSchema1784160000000 implements MigrationInterface {
  name = 'InitialSchema1784160000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE users (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        display_name varchar(100) NOT NULL,
        avatar_url text,
        time_zone varchar(100) NOT NULL DEFAULT 'Asia/Seoul',
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        deleted_at timestamptz,
        CONSTRAINT ck_users_display_name_not_blank
          CHECK (btrim(display_name) <> ''),
        CONSTRAINT ck_users_time_zone_not_blank
          CHECK (btrim(time_zone) <> '')
      )
    `)

    await queryRunner.query(`
      CREATE TABLE user_auth_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider varchar(20) NOT NULL,
        provider_account_id varchar(100) NOT NULL,
        provider_login varchar(100) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_user_auth_accounts_provider
          CHECK (provider IN ('GITHUB')),
        CONSTRAINT ck_user_auth_accounts_provider_id_not_blank
          CHECK (btrim(provider_account_id) <> ''),
        CONSTRAINT ck_user_auth_accounts_login_not_blank
          CHECK (btrim(provider_login) <> ''),
        CONSTRAINT uk_user_auth_accounts_provider_account
          UNIQUE (provider, provider_account_id),
        CONSTRAINT uk_user_auth_accounts_user_provider
          UNIQUE (user_id, provider)
      )
    `)

    await queryRunner.query(`
      CREATE TABLE devices (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        name varchar(100) NOT NULL,
        token_hash char(64) NOT NULL,
        plugin_version varchar(50),
        last_seen_at timestamptz,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_devices_name_not_blank CHECK (btrim(name) <> ''),
        CONSTRAINT ck_devices_token_hash
          CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_devices_expiration
          CHECK (expires_at > created_at),
        CONSTRAINT uk_devices_token_hash UNIQUE (token_hash),
        CONSTRAINT uk_devices_id_user UNIQUE (id, user_id)
      )
    `)

    await queryRunner.query(`
      CREATE INDEX ix_devices_user_active
        ON devices (user_id, expires_at)
        WHERE revoked_at IS NULL
    `)

    await queryRunner.query(`
      CREATE TABLE ai_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        provider varchar(20) NOT NULL DEFAULT 'CODEX',
        status varchar(30) NOT NULL,
        origin varchar(20) NOT NULL,
        external_session_key char(64),
        external_turn_key char(64),
        started_at timestamptz NOT NULL DEFAULT now(),
        ended_at timestamptz,
        last_activity_at timestamptz NOT NULL DEFAULT now(),
        terminal_reason varchar(50),
        timing_quality varchar(20) NOT NULL DEFAULT 'EXACT',
        version integer NOT NULL DEFAULT 1,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_ai_sessions_provider CHECK (provider IN ('CODEX')),
        CONSTRAINT ck_ai_sessions_status CHECK (
          status IN (
            'RUNNING', 'WAITING_FOR_USER', 'COMPLETED', 'FAILED', 'ABANDONED'
          )
        ),
        CONSTRAINT ck_ai_sessions_origin CHECK (origin IN ('HOOK', 'MANUAL')),
        CONSTRAINT ck_ai_sessions_external_session_key CHECK (
          external_session_key IS NULL
          OR external_session_key ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT ck_ai_sessions_external_turn_key CHECK (
          external_turn_key IS NULL
          OR external_turn_key ~ '^[0-9a-f]{64}$'
        ),
        CONSTRAINT ck_ai_sessions_terminal_reason CHECK (
          terminal_reason IS NULL
          OR (
            status = 'COMPLETED'
            AND terminal_reason IN (
              'HOOK_STOP', 'MANUAL_COMPLETED', 'RECOVERED_LATE_STOP'
            )
          )
          OR (status = 'FAILED' AND terminal_reason = 'MANUAL_FAILED')
          OR (
            status = 'ABANDONED'
            AND terminal_reason IN (
              'MANUAL_CANCELLED', 'HEARTBEAT_TIMEOUT', 'MANUAL_TIMEOUT',
              'SUPERSEDED_BY_NEW_TURN'
            )
          )
        ),
        CONSTRAINT ck_ai_sessions_timing_quality
          CHECK (timing_quality IN ('EXACT', 'DEGRADED')),
        CONSTRAINT ck_ai_sessions_version CHECK (version > 0),
        CONSTRAINT ck_ai_sessions_activity_time
          CHECK (last_activity_at >= started_at),
        CONSTRAINT ck_ai_sessions_end_time
          CHECK (ended_at IS NULL OR ended_at >= started_at),
        CONSTRAINT ck_ai_sessions_terminal_state CHECK (
          (
            status IN ('RUNNING', 'WAITING_FOR_USER')
            AND ended_at IS NULL
            AND terminal_reason IS NULL
          )
          OR
          (
            status IN ('COMPLETED', 'FAILED', 'ABANDONED')
            AND ended_at IS NOT NULL
            AND terminal_reason IS NOT NULL
          )
        ),
        CONSTRAINT uk_ai_sessions_id_user UNIQUE (id, user_id)
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX uk_ai_sessions_active_user
        ON ai_sessions (user_id)
        WHERE status IN ('RUNNING', 'WAITING_FOR_USER')
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX uk_ai_sessions_external_turn
        ON ai_sessions (user_id, provider, external_turn_key)
        WHERE external_turn_key IS NOT NULL
    `)

    await queryRunner.query(`
      CREATE INDEX ix_ai_sessions_user_history
        ON ai_sessions (user_id, started_at DESC)
    `)

    await queryRunner.query(`
      CREATE INDEX ix_ai_sessions_expiration_scan
        ON ai_sessions (last_activity_at)
        WHERE status IN ('RUNNING', 'WAITING_FOR_USER')
    `)

    await queryRunner.query(`
      CREATE TABLE integration_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        event_id uuid NOT NULL,
        device_id uuid NOT NULL,
        user_id uuid NOT NULL,
        ai_session_id uuid,
        provider varchar(20) NOT NULL DEFAULT 'CODEX',
        event varchar(30) NOT NULL,
        external_session_key char(64) NOT NULL,
        external_turn_key char(64),
        observed_at timestamptz NOT NULL,
        received_at timestamptz NOT NULL DEFAULT now(),
        processing_result varchar(30) NOT NULL,
        request_hash char(64) NOT NULL,
        CONSTRAINT fk_integration_events_device_user
          FOREIGN KEY (device_id, user_id)
          REFERENCES devices(id, user_id) ON DELETE RESTRICT,
        CONSTRAINT fk_integration_events_session_user
          FOREIGN KEY (ai_session_id, user_id)
          REFERENCES ai_sessions(id, user_id) ON DELETE SET NULL (ai_session_id),
        CONSTRAINT ck_integration_events_provider CHECK (provider IN ('CODEX')),
        CONSTRAINT ck_integration_events_event CHECK (
          event IN (
            'SessionStart', 'UserPromptSubmit', 'PreToolUse',
            'PermissionRequest', 'PostToolUse', 'Stop', 'Heartbeat'
          )
        ),
        CONSTRAINT ck_integration_events_external_session_key
          CHECK (external_session_key ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_integration_events_external_turn_key CHECK (
          (
            event = 'SessionStart'
            AND (
              external_turn_key IS NULL
              OR external_turn_key ~ '^[0-9a-f]{64}$'
            )
          )
          OR
          (
            event <> 'SessionStart'
            AND external_turn_key ~ '^[0-9a-f]{64}$'
          )
        ),
        CONSTRAINT ck_integration_events_processing_result CHECK (
          processing_result IN (
            'APPLIED', 'DUPLICATE', 'DEFERRED',
            'IGNORED_TERMINAL', 'IGNORED_ORPHAN'
          )
        ),
        CONSTRAINT ck_integration_events_request_hash
          CHECK (request_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT uk_integration_events_device_event
          UNIQUE (device_id, event_id)
      )
    `)

    await queryRunner.query(`
      CREATE INDEX ix_integration_events_turn
        ON integration_events (user_id, provider, external_turn_key, received_at)
    `)

    await queryRunner.query(`
      CREATE INDEX ix_integration_events_deferred
        ON integration_events (received_at)
        WHERE processing_result = 'DEFERRED'
    `)

    await queryRunner.query(`
      CREATE TABLE quests (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        code varchar(100) NOT NULL,
        version integer NOT NULL,
        type varchar(30) NOT NULL DEFAULT 'MULTIPLE_CHOICE',
        status varchar(20) NOT NULL DEFAULT 'DRAFT',
        title varchar(200) NOT NULL,
        description text NOT NULL,
        estimated_minutes integer NOT NULL,
        reward_points integer NOT NULL DEFAULT 100,
        pass_score smallint NOT NULL,
        published_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_quests_code
          CHECK (code ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
        CONSTRAINT ck_quests_version CHECK (version > 0),
        CONSTRAINT ck_quests_type CHECK (type IN ('MULTIPLE_CHOICE')),
        CONSTRAINT ck_quests_status
          CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
        CONSTRAINT ck_quests_title_not_blank CHECK (btrim(title) <> ''),
        CONSTRAINT ck_quests_description_not_blank
          CHECK (btrim(description) <> ''),
        CONSTRAINT ck_quests_estimated_minutes CHECK (estimated_minutes > 0),
        CONSTRAINT ck_quests_reward_points CHECK (reward_points = 100),
        CONSTRAINT ck_quests_pass_score CHECK (pass_score BETWEEN 0 AND 100),
        CONSTRAINT ck_quests_published_at CHECK (
          (status = 'DRAFT' AND published_at IS NULL)
          OR (status IN ('PUBLISHED', 'ARCHIVED') AND published_at IS NOT NULL)
        ),
        CONSTRAINT uk_quests_code_version UNIQUE (code, version)
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX uk_quests_published_code
        ON quests (code)
        WHERE status = 'PUBLISHED'
    `)

    await queryRunner.query(`
      CREATE INDEX ix_quests_available
        ON quests (published_at DESC, code)
        WHERE status = 'PUBLISHED'
    `)

    await queryRunner.query(`
      CREATE TABLE quest_questions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        quest_id uuid NOT NULL REFERENCES quests(id) ON DELETE CASCADE,
        position integer NOT NULL,
        prompt text NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_quest_questions_position CHECK (position > 0),
        CONSTRAINT ck_quest_questions_prompt_not_blank
          CHECK (btrim(prompt) <> ''),
        CONSTRAINT uk_quest_questions_quest_position
          UNIQUE (quest_id, position),
        CONSTRAINT uk_quest_questions_id_quest UNIQUE (id, quest_id)
      )
    `)

    await queryRunner.query(`
      CREATE TABLE quest_options (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        question_id uuid NOT NULL
          REFERENCES quest_questions(id) ON DELETE CASCADE,
        position integer NOT NULL,
        label text NOT NULL,
        is_correct boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_quest_options_position CHECK (position > 0),
        CONSTRAINT ck_quest_options_label_not_blank CHECK (btrim(label) <> ''),
        CONSTRAINT uk_quest_options_question_position
          UNIQUE (question_id, position),
        CONSTRAINT uk_quest_options_id_question UNIQUE (id, question_id)
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX uk_quest_options_correct_answer
        ON quest_options (question_id)
        WHERE is_correct = true
    `)

    await queryRunner.query(`
      CREATE TABLE quest_attempts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        quest_id uuid NOT NULL REFERENCES quests(id) ON DELETE RESTRICT,
        ai_session_id uuid,
        status varchar(20) NOT NULL DEFAULT 'IN_PROGRESS',
        started_at timestamptz NOT NULL DEFAULT now(),
        submitted_at timestamptz,
        completed_at timestamptz,
        score smallint,
        passed boolean,
        reward_points_snapshot integer,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_quest_attempts_session_user
          FOREIGN KEY (ai_session_id, user_id)
          REFERENCES ai_sessions(id, user_id) ON DELETE SET NULL (ai_session_id),
        CONSTRAINT ck_quest_attempts_status CHECK (
          status IN ('IN_PROGRESS', 'SUBMITTED', 'COMPLETED', 'FAILED')
        ),
        CONSTRAINT ck_quest_attempts_score
          CHECK (score IS NULL OR score BETWEEN 0 AND 100),
        CONSTRAINT ck_quest_attempts_reward_snapshot CHECK (
          reward_points_snapshot IS NULL OR reward_points_snapshot = 100
        ),
        CONSTRAINT ck_quest_attempts_submission_time
          CHECK (submitted_at IS NULL OR submitted_at >= started_at),
        CONSTRAINT ck_quest_attempts_completion_time CHECK (
          completed_at IS NULL
          OR (submitted_at IS NOT NULL AND completed_at >= submitted_at)
        ),
        CONSTRAINT ck_quest_attempts_result CHECK (
          (
            status = 'IN_PROGRESS'
            AND submitted_at IS NULL
            AND completed_at IS NULL
            AND score IS NULL
            AND passed IS NULL
            AND reward_points_snapshot IS NULL
          )
          OR
          (
            status = 'SUBMITTED'
            AND submitted_at IS NOT NULL
            AND completed_at IS NULL
            AND score IS NULL
            AND passed IS NULL
            AND reward_points_snapshot IS NULL
          )
          OR
          (
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
        ),
        CONSTRAINT uk_quest_attempts_id_user_quest
          UNIQUE (id, user_id, quest_id),
        CONSTRAINT uk_quest_attempts_id_quest UNIQUE (id, quest_id)
      )
    `)

    await queryRunner.query(`
      CREATE UNIQUE INDEX uk_quest_attempts_active
        ON quest_attempts (user_id, quest_id)
        WHERE status IN ('IN_PROGRESS', 'SUBMITTED')
    `)

    await queryRunner.query(`
      CREATE INDEX ix_quest_attempts_user_history
        ON quest_attempts (user_id, started_at DESC)
    `)

    await queryRunner.query(`
      CREATE TABLE quest_attempt_answers (
        attempt_id uuid NOT NULL,
        quest_id uuid NOT NULL,
        question_id uuid NOT NULL,
        selected_option_id uuid NOT NULL,
        is_correct boolean NOT NULL,
        answered_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (attempt_id, question_id),
        CONSTRAINT fk_quest_attempt_answers_attempt_quest
          FOREIGN KEY (attempt_id, quest_id)
          REFERENCES quest_attempts(id, quest_id) ON DELETE CASCADE,
        CONSTRAINT fk_quest_attempt_answers_question_quest
          FOREIGN KEY (question_id, quest_id)
          REFERENCES quest_questions(id, quest_id) ON DELETE RESTRICT,
        CONSTRAINT fk_quest_attempt_answers_option_question
          FOREIGN KEY (selected_option_id, question_id)
          REFERENCES quest_options(id, question_id) ON DELETE RESTRICT
      )
    `)

    await queryRunner.query(`
      CREATE TABLE point_ledger (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL,
        quest_id uuid NOT NULL,
        quest_attempt_id uuid NOT NULL,
        entry_type varchar(30) NOT NULL,
        points integer NOT NULL,
        description varchar(200) NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT fk_point_ledger_attempt_owner
          FOREIGN KEY (quest_attempt_id, user_id, quest_id)
          REFERENCES quest_attempts(id, user_id, quest_id) ON DELETE RESTRICT,
        CONSTRAINT ck_point_ledger_entry_type
          CHECK (entry_type IN ('QUEST_REWARD')),
        CONSTRAINT ck_point_ledger_points CHECK (points = 100),
        CONSTRAINT ck_point_ledger_description_not_blank
          CHECK (btrim(description) <> ''),
        CONSTRAINT uk_point_ledger_attempt UNIQUE (quest_attempt_id),
        CONSTRAINT uk_point_ledger_user_quest_reward
          UNIQUE (user_id, quest_id, entry_type)
      )
    `)

    await queryRunner.query(`
      CREATE INDEX ix_point_ledger_user_created
        ON point_ledger (user_id, created_at DESC)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS point_ledger')
    await queryRunner.query('DROP TABLE IF EXISTS quest_attempt_answers')
    await queryRunner.query('DROP TABLE IF EXISTS quest_attempts')
    await queryRunner.query('DROP TABLE IF EXISTS quest_options')
    await queryRunner.query('DROP TABLE IF EXISTS quest_questions')
    await queryRunner.query('DROP TABLE IF EXISTS quests')
    await queryRunner.query('DROP TABLE IF EXISTS integration_events')
    await queryRunner.query('DROP TABLE IF EXISTS ai_sessions')
    await queryRunner.query('DROP TABLE IF EXISTS devices')
    await queryRunner.query('DROP TABLE IF EXISTS user_auth_accounts')
    await queryRunner.query('DROP TABLE IF EXISTS users')
  }
}
