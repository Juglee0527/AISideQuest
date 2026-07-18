import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddSecurityControls1784192400000 implements MigrationInterface {
  name = 'AddSecurityControls1784192400000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE rate_limit_buckets (
        scope varchar(50) NOT NULL,
        key_hash char(64) NOT NULL,
        window_started_at timestamptz NOT NULL,
        request_count integer NOT NULL DEFAULT 1,
        expires_at timestamptz NOT NULL,
        PRIMARY KEY (scope, key_hash, window_started_at),
        CONSTRAINT ck_rate_limit_buckets_scope_not_blank
          CHECK (btrim(scope) <> ''),
        CONSTRAINT ck_rate_limit_buckets_key_hash
          CHECK (key_hash ~ '^[0-9a-f]{64}$'),
        CONSTRAINT ck_rate_limit_buckets_count CHECK (request_count > 0),
        CONSTRAINT ck_rate_limit_buckets_expiration
          CHECK (expires_at > window_started_at)
      )
    `)
    await queryRunner.query(`
      CREATE INDEX ix_rate_limit_buckets_expiration
      ON rate_limit_buckets (expires_at)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS rate_limit_buckets')
  }
}
