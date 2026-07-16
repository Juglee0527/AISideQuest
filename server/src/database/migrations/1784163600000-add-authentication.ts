import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddAuthentication1784163600000 implements MigrationInterface {
  name = 'AddAuthentication1784163600000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE oauth_login_states (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        state_hash char(64) NOT NULL,
        code_verifier varchar(128) NOT NULL,
        expires_at timestamptz NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_oauth_login_states_state_hash
          CHECK (state_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_oauth_login_states_code_verifier
          CHECK (code_verifier ~ '^[A-Za-z0-9_-]{43,128}$'),
        CONSTRAINT ck_oauth_login_states_expiration
          CHECK (expires_at > created_at),
        CONSTRAINT uk_oauth_login_states_state_hash UNIQUE (state_hash)
      )
    `)

    await queryRunner.query(`
      CREATE INDEX ix_oauth_login_states_expiration
        ON oauth_login_states (expires_at)
    `)

    await queryRunner.query(`
      CREATE TABLE auth_sessions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash char(64) NOT NULL,
        csrf_token_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        revoked_at timestamptz,
        last_seen_at timestamptz NOT NULL DEFAULT now(),
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_auth_sessions_token_hash
          CHECK (token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_auth_sessions_csrf_token_hash
          CHECK (csrf_token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_auth_sessions_expiration CHECK (expires_at > created_at),
        CONSTRAINT ck_auth_sessions_revocation CHECK (
          revoked_at IS NULL OR revoked_at >= created_at
        ),
        CONSTRAINT ck_auth_sessions_last_seen CHECK (last_seen_at >= created_at),
        CONSTRAINT uk_auth_sessions_token_hash UNIQUE (token_hash),
        CONSTRAINT uk_auth_sessions_id_user UNIQUE (id, user_id)
      )
    `)

    await queryRunner.query(`
      CREATE INDEX ix_auth_sessions_user_active
        ON auth_sessions (user_id, expires_at)
        WHERE revoked_at IS NULL
    `)

    await queryRunner.query(`
      CREATE INDEX ix_auth_sessions_expiration
        ON auth_sessions (expires_at)
        WHERE revoked_at IS NULL
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS auth_sessions')
    await queryRunner.query('DROP TABLE IF EXISTS oauth_login_states')
  }
}
