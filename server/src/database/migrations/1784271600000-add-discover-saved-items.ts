import type { MigrationInterface, QueryRunner } from 'typeorm'

const PREVIOUS_OPERATIONS = `
  'SESSION_MANUAL_START',
  'SESSION_END',
  'DEVICE_LINK_CREATE',
  'DEVICE_ROTATION_LINK_CREATE',
  'DEVICE_LINK_REDEEM',
  'DEVICE_LINK_REQUEST_APPROVE',
  'DEVICE_REVOKE',
  'QUEST_ATTEMPT_START',
  'QUEST_ATTEMPT_SUBMIT'
`

export class AddDiscoverSavedItems1784271600000 implements MigrationInterface {
  name = 'AddDiscoverSavedItems1784271600000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE api_idempotency_keys
      DROP CONSTRAINT ck_api_idempotency_keys_operation,
      ADD CONSTRAINT ck_api_idempotency_keys_operation CHECK (
        operation IN (
          ${PREVIOUS_OPERATIONS},
          'DISCOVER_ITEM_SAVE',
          'DISCOVER_ITEM_DELETE'
        )
      )
    `)
    await queryRunner.query(`
      CREATE TABLE discover_saved_items (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        source varchar(32) NOT NULL,
        source_item_id varchar(240) NOT NULL,
        item jsonb NOT NULL,
        saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT uk_discover_saved_items_user_source_item
          UNIQUE (user_id, source_item_id),
        CONSTRAINT chk_discover_saved_items_source CHECK (
          source IN ('HACKER_NEWS', 'REMOTIVE', 'DEV', 'STACK_EXCHANGE', 'GITHUB', 'ALGORA')
        ),
        CONSTRAINT chk_discover_saved_items_item_object
          CHECK (jsonb_typeof(item) = 'object'),
        CONSTRAINT chk_discover_saved_items_item_size
          CHECK (pg_column_size(item) <= 16384),
        CONSTRAINT chk_discover_saved_items_identity
          CHECK (item->>'id' = source_item_id AND item->>'source' = source)
      )
    `)
    await queryRunner.query(`
      CREATE INDEX idx_discover_saved_items_user_saved
      ON discover_saved_items (user_id, saved_at DESC, id DESC)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE discover_saved_items')
    await queryRunner.query(`
      ALTER TABLE api_idempotency_keys
      DROP CONSTRAINT ck_api_idempotency_keys_operation,
      ADD CONSTRAINT ck_api_idempotency_keys_operation CHECK (
        operation IN (${PREVIOUS_OPERATIONS})
      )
    `)
  }
}
