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
  'QUEST_ATTEMPT_SUBMIT',
  'DISCOVER_ITEM_SAVE',
  'DISCOVER_ITEM_DELETE'
`

const INTEREST_TAG_VALUES = [
  'javascript', 'typescript', 'react', 'node.js', 'python',
  'java', 'go', 'rust', 'csharp', 'cpp', 'mobile', 'devops',
  'cloud', 'data', 'ai-ml', 'security', 'databases', 'web',
  'testing', 'open-source',
]
const INTEREST_TAGS = INTEREST_TAG_VALUES.map((tag) => `'${tag}'`).join(', ')
const UNIQUE_INTEREST_TAGS = INTEREST_TAG_VALUES
  .map((tag) => `cardinality(array_positions(tags, '${tag}')) <= 1`)
  .join(' AND ')

export class AddDiscoverInterests1784275200000 implements MigrationInterface {
  name = 'AddDiscoverInterests1784275200000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE api_idempotency_keys
      DROP CONSTRAINT ck_api_idempotency_keys_operation,
      ADD CONSTRAINT ck_api_idempotency_keys_operation CHECK (
        operation IN (${PREVIOUS_OPERATIONS}, 'DISCOVER_INTERESTS_UPDATE')
      )
    `)
    await queryRunner.query(`
      CREATE TABLE discover_user_interests (
        user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        tags text[] NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        CONSTRAINT chk_discover_user_interests_count
          CHECK (cardinality(tags) BETWEEN 1 AND 10),
        CONSTRAINT chk_discover_user_interests_values
          CHECK (tags <@ ARRAY[${INTEREST_TAGS}]::text[]),
        CONSTRAINT chk_discover_user_interests_unique
          CHECK (${UNIQUE_INTEREST_TAGS}),
        CONSTRAINT chk_discover_user_interests_no_null
          CHECK (array_position(tags, NULL) IS NULL)
      )
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE discover_user_interests')
    await queryRunner.query(`
      ALTER TABLE api_idempotency_keys
      DROP CONSTRAINT ck_api_idempotency_keys_operation,
      ADD CONSTRAINT ck_api_idempotency_keys_operation CHECK (
        operation IN (${PREVIOUS_OPERATIONS})
      )
    `)
  }
}
