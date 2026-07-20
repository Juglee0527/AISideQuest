import type { MigrationInterface, QueryRunner } from 'typeorm'

export class AddSanitizedSessionContext1784264400000
implements MigrationInterface {
  name = 'AddSanitizedSessionContext1784264400000'

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE ai_sessions
      ADD COLUMN workspace_label varchar(64),
      ADD COLUMN operation_label varchar(30),
      ADD CONSTRAINT ck_ai_sessions_workspace_label CHECK (
        workspace_label IS NULL
        OR (
          workspace_label = btrim(workspace_label)
          AND workspace_label <> ''
          AND workspace_label !~ '[\\\\/]'
          AND workspace_label !~ '[[:cntrl:]]'
        )
      ),
      ADD CONSTRAINT ck_ai_sessions_operation_label CHECK (
        operation_label IS NULL OR operation_label IN (
          'git status', 'git diff', 'git log', 'git show',
          'npm test', 'npm build', 'npm typecheck', 'npm lint', 'npm install',
          'Gradle test', 'Gradle build', 'Maven test', 'Maven build',
          'Python test', 'Cargo test', 'Go test', 'Docker',
          '코드 변경', '기타 명령'
        )
      )
    `)

    await queryRunner.query(`
      ALTER TABLE integration_events
      ADD COLUMN workspace_label varchar(64),
      ADD COLUMN operation_label varchar(30),
      ADD CONSTRAINT ck_integration_events_workspace_label CHECK (
        workspace_label IS NULL
        OR (
          workspace_label = btrim(workspace_label)
          AND workspace_label <> ''
          AND workspace_label !~ '[\\\\/]'
          AND workspace_label !~ '[[:cntrl:]]'
        )
      ),
      ADD CONSTRAINT ck_integration_events_operation_label CHECK (
        operation_label IS NULL OR operation_label IN (
          'git status', 'git diff', 'git log', 'git show',
          'npm test', 'npm build', 'npm typecheck', 'npm lint', 'npm install',
          'Gradle test', 'Gradle build', 'Maven test', 'Maven build',
          'Python test', 'Cargo test', 'Go test', 'Docker',
          '코드 변경', '기타 명령'
        )
      )
    `)
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE integration_events
      DROP CONSTRAINT IF EXISTS ck_integration_events_operation_label,
      DROP CONSTRAINT IF EXISTS ck_integration_events_workspace_label,
      DROP COLUMN IF EXISTS operation_label,
      DROP COLUMN IF EXISTS workspace_label
    `)

    await queryRunner.query(`
      ALTER TABLE ai_sessions
      DROP CONSTRAINT IF EXISTS ck_ai_sessions_operation_label,
      DROP CONSTRAINT IF EXISTS ck_ai_sessions_workspace_label,
      DROP COLUMN IF EXISTS operation_label,
      DROP COLUMN IF EXISTS workspace_label
    `)
  }
}
