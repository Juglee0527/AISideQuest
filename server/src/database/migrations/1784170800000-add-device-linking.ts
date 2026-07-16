import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddDeviceLinking1784170800000 implements MigrationInterface {
  name = 'AddDeviceLinking1784170800000'

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
          'DEVICE_REVOKE'
        )
      )
    `)

    await queryRunner.query(`
      CREATE TABLE device_link_codes (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id uuid REFERENCES devices(id) ON DELETE CASCADE,
        purpose varchar(10) NOT NULL,
        code_hash char(64) NOT NULL,
        expires_at timestamptz NOT NULL,
        consumed_at timestamptz,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_device_link_codes_purpose CHECK (
          purpose IN ('CONNECT', 'ROTATE')
        ),
        CONSTRAINT ck_device_link_codes_target CHECK (
          (purpose = 'CONNECT' AND device_id IS NULL)
          OR (purpose = 'ROTATE' AND device_id IS NOT NULL)
        ),
        CONSTRAINT ck_device_link_codes_hash
          CHECK (code_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_device_link_codes_expiry
          CHECK (expires_at > created_at),
        CONSTRAINT uk_device_link_codes_hash UNIQUE (code_hash)
      )
    `)

    await queryRunner.query(`
      CREATE INDEX ix_device_link_codes_user_active
        ON device_link_codes (user_id, created_at DESC)
        WHERE consumed_at IS NULL
    `)

    await queryRunner.query(`
      CREATE INDEX ix_device_link_codes_expires_at
        ON device_link_codes (expires_at)
        WHERE consumed_at IS NULL
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS device_link_codes')
    await queryRunner.query(`
      ALTER TABLE api_idempotency_keys
      DROP CONSTRAINT ck_api_idempotency_keys_operation,
      ADD CONSTRAINT ck_api_idempotency_keys_operation CHECK (
        operation IN ('SESSION_MANUAL_START', 'SESSION_END')
      )
    `)
  }
}
