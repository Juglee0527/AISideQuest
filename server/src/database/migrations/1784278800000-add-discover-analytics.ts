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
  'DISCOVER_ITEM_DELETE',
  'DISCOVER_INTERESTS_UPDATE'
`

export class AddDiscoverAnalytics1784278800000 implements MigrationInterface {
  name = 'AddDiscoverAnalytics1784278800000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE api_idempotency_keys
      DROP CONSTRAINT ck_api_idempotency_keys_operation,
      ADD CONSTRAINT ck_api_idempotency_keys_operation CHECK (
        operation IN (${PREVIOUS_OPERATIONS}, 'DISCOVER_ANALYTICS_EVENT')
      )
    `)
    await queryRunner.query(`
      CREATE TABLE discover_analytics_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        event_name varchar(32) NOT NULL,
        source varchar(32),
        category varchar(16),
        occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        expires_at timestamptz NOT NULL DEFAULT clock_timestamp() + interval '90 days',
        CONSTRAINT chk_discover_analytics_event_name CHECK (
          event_name IN ('DISCOVER_VIEW', 'TAB_VIEW', 'OUTBOUND_CLICK', 'SAVE')
        ),
        CONSTRAINT chk_discover_analytics_source CHECK (
          source IS NULL OR source IN (
            'HACKER_NEWS', 'REMOTIVE', 'DEV', 'STACK_EXCHANGE', 'GITHUB', 'ALGORA'
          )
        ),
        CONSTRAINT chk_discover_analytics_category CHECK (
          category IS NULL OR category IN ('EARNING', 'NEWS', 'COMMUNITY')
        ),
        CONSTRAINT chk_discover_analytics_dimensions CHECK (
          (event_name = 'DISCOVER_VIEW' AND source IS NULL AND category IS NULL)
          OR (event_name = 'TAB_VIEW' AND source IS NULL AND category IS NOT NULL)
          OR (event_name IN ('OUTBOUND_CLICK', 'SAVE') AND source IS NOT NULL AND category IS NOT NULL)
        ),
        CONSTRAINT chk_discover_analytics_expiry CHECK (
          expires_at > occurred_at
          AND expires_at <= occurred_at + interval '90 days 1 minute'
        )
      )
    `)
    await queryRunner.query(`
      CREATE INDEX idx_discover_analytics_user_occurred
      ON discover_analytics_events (user_id, occurred_at DESC, id DESC)
    `)
    await queryRunner.query(`
      CREATE INDEX idx_discover_analytics_expiry
      ON discover_analytics_events (expires_at)
    `)
    await queryRunner.query(`
      CREATE INDEX idx_discover_analytics_pilot_rollup
      ON discover_analytics_events (event_name, occurred_at, user_id)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE discover_analytics_events')
    await queryRunner.query(`
      ALTER TABLE api_idempotency_keys
      DROP CONSTRAINT ck_api_idempotency_keys_operation,
      ADD CONSTRAINT ck_api_idempotency_keys_operation CHECK (
        operation IN (${PREVIOUS_OPERATIONS})
      )
    `)
  }
}
