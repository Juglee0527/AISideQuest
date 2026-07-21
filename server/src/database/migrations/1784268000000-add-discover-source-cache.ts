import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddDiscoverSourceCache1784268000000 implements MigrationInterface {
  name = 'AddDiscoverSourceCache1784268000000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE discover_source_cache (
        source varchar(32) PRIMARY KEY,
        items jsonb NOT NULL,
        refreshed_at timestamptz NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT chk_discover_source_cache_source CHECK (
          source IN ('HACKER_NEWS', 'REMOTIVE', 'DEV', 'STACK_EXCHANGE', 'GITHUB', 'ALGORA')
        ),
        CONSTRAINT chk_discover_source_cache_items_array CHECK (jsonb_typeof(items) = 'array'),
        CONSTRAINT chk_discover_source_cache_items_size CHECK (pg_column_size(items) <= 5242880)
      )
    `)
    await queryRunner.query(`
      CREATE INDEX idx_discover_source_cache_refreshed_at
      ON discover_source_cache (refreshed_at)
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE discover_source_cache')
  }
}
