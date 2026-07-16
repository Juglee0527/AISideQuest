import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddSessionApiIdempotency1784167200000
  implements MigrationInterface
{
  name = 'AddSessionApiIdempotency1784167200000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE api_idempotency_keys (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        idempotency_key uuid NOT NULL,
        operation varchar(30) NOT NULL,
        request_hash char(64) NOT NULL,
        response_body jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT ck_api_idempotency_keys_operation CHECK (
          operation IN ('SESSION_MANUAL_START', 'SESSION_END')
        ),
        CONSTRAINT ck_api_idempotency_keys_request_hash
          CHECK (request_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_api_idempotency_keys_response_body
          CHECK (jsonb_typeof(response_body) = 'object'),
        CONSTRAINT uk_api_idempotency_keys_user_key
          UNIQUE (user_id, idempotency_key)
      )
    `)

    await queryRunner.query(`
      CREATE INDEX ix_api_idempotency_keys_created_at
        ON api_idempotency_keys (created_at)
    `)

    await queryRunner.query(`
      ALTER TABLE integration_events
      ADD COLUMN response_body jsonb,
      ADD CONSTRAINT ck_integration_events_response_body CHECK (
        response_body IS NULL OR jsonb_typeof(response_body) = 'object'
      )
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE integration_events
      DROP CONSTRAINT IF EXISTS ck_integration_events_response_body,
      DROP COLUMN IF EXISTS response_body
    `)
    await queryRunner.query('DROP TABLE IF EXISTS api_idempotency_keys')
  }
}
