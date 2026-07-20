import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddBrowserDeviceLinking1784199600000 implements MigrationInterface {
  name = 'AddBrowserDeviceLinking1784199600000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE oauth_login_states
      ADD COLUMN return_path varchar(500),
      ADD CONSTRAINT ck_oauth_login_states_return_path CHECK (
        return_path IS NULL
        OR (return_path LIKE '/%' AND return_path NOT LIKE '//%')
      )
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
          'DEVICE_LINK_REQUEST_APPROVE',
          'DEVICE_REVOKE',
          'QUEST_ATTEMPT_START',
          'QUEST_ATTEMPT_SUBMIT'
        )
      )
    `)

    await queryRunner.query(`
      CREATE TABLE device_link_requests (
        id uuid PRIMARY KEY,
        request_hash char(64) NOT NULL,
        verifier_challenge char(43) NOT NULL,
        device_token_hash char(64) NOT NULL,
        device_name varchar(100) NOT NULL,
        plugin_version varchar(50) NOT NULL,
        user_id uuid REFERENCES users(id) ON DELETE CASCADE,
        device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
        expires_at timestamptz NOT NULL,
        approved_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_device_link_requests_request_hash
          CHECK (request_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_device_link_requests_verifier_challenge
          CHECK (verifier_challenge ~ '^[A-Za-z0-9_-]{43}$'),
        CONSTRAINT ck_device_link_requests_device_token_hash
          CHECK (device_token_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_device_link_requests_device_name_not_blank
          CHECK (btrim(device_name) <> ''),
        CONSTRAINT ck_device_link_requests_plugin_version
          CHECK (plugin_version ~ '^[0-9A-Za-z][0-9A-Za-z.+_-]{0,49}$'),
        CONSTRAINT ck_device_link_requests_expiry
          CHECK (expires_at > created_at),
        CONSTRAINT ck_device_link_requests_approval CHECK (
          (approved_at IS NULL AND user_id IS NULL AND device_id IS NULL)
          OR (approved_at IS NOT NULL AND user_id IS NOT NULL AND device_id IS NOT NULL)
        ),
        CONSTRAINT uk_device_link_requests_device UNIQUE (device_id)
      )
    `)

    await queryRunner.query(`
      CREATE INDEX ix_device_link_requests_expiration
        ON device_link_requests (expires_at)
        WHERE approved_at IS NULL
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS device_link_requests')
    await queryRunner.query(`
      ALTER TABLE oauth_login_states
      DROP CONSTRAINT IF EXISTS ck_oauth_login_states_return_path,
      DROP COLUMN IF EXISTS return_path
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
          'DEVICE_REVOKE',
          'QUEST_ATTEMPT_START',
          'QUEST_ATTEMPT_SUBMIT'
        )
      )
    `)
  }
}
