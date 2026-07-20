import {
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import type { EntityManager } from 'typeorm'

import { hashToken } from '../auth/auth-crypto'
import { ApiIdempotencyService } from '../common/idempotency/api-idempotency.service'
import { DatabaseService } from '../database/database.service'
import type { AppEnvironment } from '../config/environment'
import type { QuestAnswerDto } from './quest-attempt.dto'
import type {
  QuestAttemptQuestionRow,
  QuestAttemptRow,
  QuestAttemptSnapshot,
  QuestAttemptSubmissionSnapshot,
} from './quest-attempt.types'

const ACTIVE_SESSION_STATUSES = new Set(['RUNNING', 'WAITING_FOR_USER'])
const SUBMISSION_GRACE_MS = 5 * 60 * 1_000

export function isWithinSubmissionGrace(currentTime: Date, endedAt: Date) {
  return currentTime.getTime() <= endedAt.getTime() + SUBMISSION_GRACE_MS
}

const ATTEMPT_COLUMNS = `
  attempt.id,
  attempt.user_id,
  attempt.quest_id,
  attempt.ai_session_id,
  attempt.status AS attempt_status,
  attempt.started_at,
  attempt.submitted_at,
  attempt.completed_at,
  attempt.score,
  attempt.passed,
  attempt.reward_points_snapshot,
  quest.code,
  quest.version,
  quest.title,
  quest.pass_score,
  quest.reward_points,
  quest.retry_allowed,
  session.status AS session_status,
  session.ended_at AS session_ended_at
`

interface IdRow { id: string }
interface DatabaseTimeRow { current_time: Date }
interface CorrectCountRow { correct_count: number }
interface PointAwardRow { id: string; points: number }

@Injectable()
export class QuestAttemptService {
  constructor(
    private readonly databaseService: DatabaseService,
    private readonly apiIdempotencyService: ApiIdempotencyService,
    private readonly configService: ConfigService<AppEnvironment, true>,
  ) {}

  async startAttempt(userId: string, code: string, idempotencyKey: string) {
    const requestHash = hashToken(JSON.stringify({
      operation: 'QUEST_ATTEMPT_START',
      code,
    }))

    return this.databaseService.transaction(async (manager) => {
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`AISIDEQUEST:QUEST_ATTEMPT:${userId}:${code}`],
      )
      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`AISIDEQUEST:IDEMPOTENCY:${userId}:${idempotencyKey}`],
      )

      const stored = await this.apiIdempotencyService.getResponse<{
        created: boolean
        attempt: QuestAttemptSnapshot
      }>(manager, userId, idempotencyKey, requestHash)
      if (stored) return stored

      const currentTime = await this.getDatabaseTime(manager)
      const sessions = (await manager.query(
        `SELECT id
         FROM ai_sessions
         WHERE user_id = $1
           AND status IN ('RUNNING', 'WAITING_FOR_USER')
         ORDER BY started_at DESC, id DESC
         FOR UPDATE`,
        [userId],
      )) as IdRow[]
      const session = sessions[0]
      if (!session) {
        throw new ConflictException({ code: 'ACTIVE_AI_SESSION_REQUIRED' })
      }

      const quests = (await manager.query(
        `SELECT id
         FROM quests quest
         WHERE code = $1
           AND status = 'PUBLISHED'
           AND EXISTS (
             SELECT 1 FROM quest_questions question
             WHERE question.quest_id = quest.id
           )
           AND NOT EXISTS (
             SELECT 1
             FROM quest_questions question
             WHERE question.quest_id = quest.id
               AND (
                 (SELECT count(*) FROM quest_options option
                  WHERE option.question_id = question.id) < 2
                 OR
                 (SELECT count(*) FROM quest_options option
                  WHERE option.question_id = question.id
                    AND option.is_correct = true) <> 1
               )
           )
         FOR SHARE`,
        [code],
      )) as IdRow[]
      const quest = quests[0]
      if (!quest) this.notFound('QUEST_NOT_FOUND')

      await this.expireAttempts(manager, userId, quest.id, currentTime)

      const passed = (await manager.query(
        `SELECT id FROM quest_attempts
         WHERE user_id = $1 AND quest_id = $2
           AND status = 'COMPLETED' AND passed = true
         LIMIT 1`,
        [userId, quest.id],
      )) as IdRow[]
      if (passed[0]) {
        throw new ConflictException({ code: 'QUEST_ALREADY_PASSED' })
      }

      const active = await this.findActiveAttempt(manager, userId, quest.id)
      if (active) {
        const response = {
          created: false,
          attempt: await this.toSnapshot(manager, active, currentTime),
        }
        await this.apiIdempotencyService.storeResponse(
          manager,
          userId,
          idempotencyKey,
          'QUEST_ATTEMPT_START',
          requestHash,
          response,
        )
        return response
      }

      const latest = (await manager.query(
        `SELECT attempt.status AS attempt_status, quest.retry_allowed
         FROM quest_attempts attempt
         JOIN quests quest ON quest.id = attempt.quest_id
         WHERE attempt.user_id = $1 AND attempt.quest_id = $2
         ORDER BY attempt.started_at DESC, attempt.id DESC
         LIMIT 1`,
        [userId, quest.id],
      )) as Array<{ attempt_status: string; retry_allowed: boolean }>
      if (
        latest[0]
        && ['FAILED', 'EXPIRED'].includes(latest[0].attempt_status)
        && !latest[0].retry_allowed
      ) {
        throw new ConflictException({ code: 'QUEST_RETRY_NOT_ALLOWED' })
      }

      const inserted = (await manager.query(
        `INSERT INTO quest_attempts (
           user_id, quest_id, ai_session_id, status, started_at
         ) VALUES ($1, $2, $3, 'IN_PROGRESS', $4)
         RETURNING id`,
        [userId, quest.id, session.id, currentTime],
      )) as IdRow[]
      const attempt = await this.findAttempt(manager, userId, inserted[0].id, false)
      if (!attempt) throw new Error('Failed to create quest attempt')

      const response = {
        created: true,
        attempt: await this.toSnapshot(manager, attempt, currentTime),
      }
      await this.apiIdempotencyService.storeResponse(
        manager,
        userId,
        idempotencyKey,
        'QUEST_ATTEMPT_START',
        requestHash,
        response,
      )
      return response
    })
  }

  async getAttempt(userId: string, attemptId: string) {
    return this.databaseService.transaction(async (manager) => {
      const currentTime = await this.getDatabaseTime(manager)
      let attempt = await this.findAttempt(manager, userId, attemptId, true)
      if (!attempt) this.notFound('QUEST_ATTEMPT_NOT_FOUND')
      attempt = await this.expireAttemptIfNeeded(manager, attempt, currentTime)
      return this.toSnapshot(manager, attempt, currentTime)
    })
  }

  async replaceAnswers(
    userId: string,
    attemptId: string,
    answers: QuestAnswerDto[],
  ) {
    return this.databaseService.transaction(async (manager) => {
      const currentTime = await this.getDatabaseTime(manager)
      let attempt = await this.findAttempt(manager, userId, attemptId, true)
      if (!attempt) this.notFound('QUEST_ATTEMPT_NOT_FOUND')
      attempt = await this.expireAttemptIfNeeded(manager, attempt, currentTime)
      this.assertEditable(attempt)

      const questionIds = new Set(answers.map((answer) => answer.questionId))
      if (questionIds.size !== answers.length) {
        throw new UnprocessableEntityException({ code: 'DUPLICATE_QUESTION_ANSWER' })
      }

      if (answers.length > 0) {
        const validRows = (await manager.query(
          `SELECT question.id AS question_id, option.id AS option_id
           FROM quest_questions question
           JOIN quest_options option ON option.question_id = question.id
           WHERE question.quest_id = $1
             AND (question.id, option.id) IN (
               SELECT * FROM unnest($2::uuid[], $3::uuid[])
             )`,
          [
            attempt.quest_id,
            answers.map((answer) => answer.questionId),
            answers.map((answer) => answer.selectedOptionId),
          ],
        )) as Array<{ question_id: string; option_id: string }>
        if (validRows.length !== answers.length) {
          throw new UnprocessableEntityException({ code: 'INVALID_QUEST_ANSWER' })
        }
      }

      await manager.query(
        'DELETE FROM quest_attempt_answers WHERE attempt_id = $1',
        [attempt.id],
      )
      if (answers.length > 0) {
        await manager.query(
          `INSERT INTO quest_attempt_answers (
             attempt_id, quest_id, question_id, selected_option_id, is_correct
           )
           SELECT $1, $2, answer.question_id, answer.option_id, NULL
           FROM unnest($3::uuid[], $4::uuid[])
             AS answer(question_id, option_id)`,
          [
            attempt.id,
            attempt.quest_id,
            answers.map((answer) => answer.questionId),
            answers.map((answer) => answer.selectedOptionId),
          ],
        )
      }

      return this.toSnapshot(manager, attempt, currentTime)
    })
  }

  async submitAttempt(userId: string, attemptId: string, idempotencyKey: string) {
    if (!this.configService.getOrThrow('QUEST_REWARDS_ENABLED')) {
      throw new ServiceUnavailableException({ code: 'QUEST_REWARDS_PAUSED' })
    }

    const requestHash = hashToken(JSON.stringify({
      operation: 'QUEST_ATTEMPT_SUBMIT',
      attemptId,
    }))

    return this.databaseService.transaction(async (manager) => {
      const currentTime = await this.getDatabaseTime(manager)
      let attempt = await this.findAttempt(manager, userId, attemptId, true)
      if (!attempt) this.notFound('QUEST_ATTEMPT_NOT_FOUND')

      await manager.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
        [`AISIDEQUEST:IDEMPOTENCY:${userId}:${idempotencyKey}`],
      )

      const stored = await this.apiIdempotencyService.getResponse<QuestAttemptSubmissionSnapshot>(
        manager,
        userId,
        idempotencyKey,
        requestHash,
      )
      if (stored) return stored

      attempt = await this.expireAttemptIfNeeded(manager, attempt, currentTime)
      if (attempt.attempt_status === 'EXPIRED') {
        throw new ConflictException({ code: 'QUEST_ATTEMPT_EXPIRED' })
      }
      if (['COMPLETED', 'FAILED'].includes(attempt.attempt_status)) {
        const response = {
          attempt: await this.toSnapshot(manager, attempt, currentTime),
          pointAward: await this.findPointAward(manager, userId, attempt.id),
        }
        await this.apiIdempotencyService.storeResponse(
          manager,
          userId,
          idempotencyKey,
          'QUEST_ATTEMPT_SUBMIT',
          requestHash,
          response,
        )
        return response
      }
      this.assertEditable(attempt)

      const counts = (await manager.query(
        `SELECT
           count(DISTINCT question.id)::integer AS question_count,
           count(DISTINCT answer.question_id)::integer AS answer_count,
           count(DISTINCT question.id) FILTER (
             WHERE option_count.count < 2 OR option_count.correct_count <> 1
           )::integer AS invalid_question_count
         FROM quest_questions question
         LEFT JOIN quest_attempt_answers answer
           ON answer.attempt_id = $2 AND answer.question_id = question.id
         JOIN LATERAL (
           SELECT count(*)::integer AS count,
                  count(*) FILTER (WHERE option.is_correct)::integer AS correct_count
           FROM quest_options option
           WHERE option.question_id = question.id
         ) option_count ON true
         WHERE question.quest_id = $1`,
        [attempt.quest_id, attempt.id],
      )) as Array<{
        question_count: number
        answer_count: number
        invalid_question_count: number
      }>
      const count = counts[0]
      if (!count || count.question_count === 0 || count.invalid_question_count > 0) {
        throw new UnprocessableEntityException({ code: 'INVALID_PUBLISHED_QUEST' })
      }
      if (count.answer_count !== count.question_count) {
        throw new UnprocessableEntityException({ code: 'QUEST_ATTEMPT_INCOMPLETE' })
      }

      const correctRows = (await manager.query(
        `WITH graded AS (
           UPDATE quest_attempt_answers answer
           SET is_correct = option.is_correct,
               answered_at = $2
           FROM quest_options option
           WHERE answer.attempt_id = $1
             AND option.id = answer.selected_option_id
             AND option.question_id = answer.question_id
           RETURNING answer.is_correct
         )
         SELECT count(*) FILTER (WHERE is_correct)::integer AS correct_count
         FROM graded`,
        [attempt.id, currentTime],
      )) as CorrectCountRow[]
      const score = Math.floor(
        ((correctRows[0]?.correct_count ?? 0) * 100) / count.question_count,
      )
      const passed = score >= attempt.pass_score
      await manager.query(
        `UPDATE quest_attempts
         SET status = $3,
             submitted_at = $4,
             completed_at = $4,
             score = $5,
             passed = $6,
             reward_points_snapshot = reward_points_snapshot_value.reward_points,
             updated_at = $4
         FROM (
           SELECT reward_points FROM quests WHERE id = $2
         ) reward_points_snapshot_value
         WHERE quest_attempts.id = $1
         RETURNING quest_attempts.id`,
        [
          attempt.id,
          attempt.quest_id,
          passed ? 'COMPLETED' : 'FAILED',
          currentTime,
          score,
          passed,
        ],
      )

      if (passed) {
        await manager.query(
          `INSERT INTO point_ledger (
             user_id, quest_id, quest_attempt_id,
             entry_type, points, description, created_at
           ) VALUES ($1, $2, $3, 'QUEST_REWARD', $4, $5, $6)`,
          [
            userId,
            attempt.quest_id,
            attempt.id,
            attempt.reward_points,
            `First pass reward for ${attempt.code} v${attempt.version}`,
            currentTime,
          ],
        )
      }

      attempt = await this.findAttempt(manager, userId, attemptId, false)
      if (!attempt) throw new Error('Failed to reload submitted quest attempt')
      const response = {
        attempt: await this.toSnapshot(manager, attempt, currentTime),
        pointAward: await this.findPointAward(manager, userId, attempt.id),
      }
      await this.apiIdempotencyService.storeResponse(
        manager,
        userId,
        idempotencyKey,
        'QUEST_ATTEMPT_SUBMIT',
        requestHash,
        response,
      )
      return response
    })
  }

  private async findPointAward(
    manager: EntityManager,
    userId: string,
    attemptId: string,
  ) {
    const rows = (await manager.query(
      `SELECT id, points
       FROM point_ledger
       WHERE user_id = $1 AND quest_attempt_id = $2
       LIMIT 1`,
      [userId, attemptId],
    )) as PointAwardRow[]
    const award = rows[0]
    return award
      ? { ledgerEntryId: award.id, points: award.points }
      : null
  }

  private async findActiveAttempt(
    manager: EntityManager,
    userId: string,
    questId: string,
  ) {
    const rows = (await manager.query(
      `SELECT ${ATTEMPT_COLUMNS}
       FROM quest_attempts attempt
       JOIN quests quest ON quest.id = attempt.quest_id
       JOIN ai_sessions session ON session.id = attempt.ai_session_id
       WHERE attempt.user_id = $1 AND attempt.quest_id = $2
         AND attempt.status IN ('IN_PROGRESS', 'SUBMITTED')
       ORDER BY attempt.started_at DESC, attempt.id DESC
       LIMIT 1`,
      [userId, questId],
    )) as QuestAttemptRow[]
    return rows[0] ?? null
  }

  private async findAttempt(
    manager: EntityManager,
    userId: string,
    attemptId: string,
    lock: boolean,
  ) {
    const rows = (await manager.query(
      `SELECT ${ATTEMPT_COLUMNS}
       FROM quest_attempts attempt
       JOIN quests quest ON quest.id = attempt.quest_id
       JOIN ai_sessions session ON session.id = attempt.ai_session_id
       WHERE attempt.id = $1 AND attempt.user_id = $2
       ${lock ? 'FOR UPDATE OF attempt, session' : ''}`,
      [attemptId, userId],
    )) as QuestAttemptRow[]
    return rows[0] ?? null
  }

  private async expireAttempts(
    manager: EntityManager,
    userId: string,
    questId: string,
    currentTime: Date,
  ) {
    await manager.query(
      `UPDATE quest_attempts attempt
       SET status = 'EXPIRED',
           completed_at = session.ended_at + interval '5 minutes',
           updated_at = $3
       FROM ai_sessions session
       WHERE attempt.ai_session_id = session.id
         AND attempt.user_id = $1
         AND attempt.quest_id = $2
         AND attempt.status IN ('IN_PROGRESS', 'SUBMITTED')
         AND session.status NOT IN ('RUNNING', 'WAITING_FOR_USER')
         AND session.ended_at + interval '5 minutes' < $3`,
      [userId, questId, currentTime],
    )
  }

  private async expireAttemptIfNeeded(
    manager: EntityManager,
    attempt: QuestAttemptRow,
    currentTime: Date,
  ) {
    if (
      !['IN_PROGRESS', 'SUBMITTED'].includes(attempt.attempt_status)
      || ACTIVE_SESSION_STATUSES.has(attempt.session_status)
      || attempt.session_ended_at === null
      || isWithinSubmissionGrace(currentTime, attempt.session_ended_at)
    ) {
      return attempt
    }

    await manager.query(
      `UPDATE quest_attempts
       SET status = 'EXPIRED', completed_at = $2, updated_at = $3
       WHERE id = $1 AND status IN ('IN_PROGRESS', 'SUBMITTED')`,
      [
        attempt.id,
        new Date(attempt.session_ended_at.getTime() + SUBMISSION_GRACE_MS),
        currentTime,
      ],
    )
    const expired = await this.findAttempt(manager, attempt.user_id, attempt.id, false)
    if (!expired) throw new Error('Failed to expire quest attempt')
    return expired
  }

  private assertEditable(attempt: QuestAttemptRow) {
    if (attempt.attempt_status !== 'IN_PROGRESS') {
      throw new ConflictException({ code: 'QUEST_ATTEMPT_NOT_EDITABLE' })
    }
  }

  private async toSnapshot(
    manager: EntityManager,
    attempt: QuestAttemptRow,
    currentTime: Date,
  ): Promise<QuestAttemptSnapshot> {
    const rows = (await manager.query(
      `SELECT
         question.id AS question_id,
         question.position AS question_position,
         question.prompt,
         option.id AS option_id,
         option.position AS option_position,
         option.label AS option_label,
         answer.selected_option_id
       FROM quest_questions question
       JOIN quest_options option ON option.question_id = question.id
       LEFT JOIN quest_attempt_answers answer
         ON answer.attempt_id = $2 AND answer.question_id = question.id
       WHERE question.quest_id = $1
       ORDER BY question.position, question.id, option.position, option.id`,
      [attempt.quest_id, attempt.id],
    )) as QuestAttemptQuestionRow[]

    const questionMap = new Map<string, QuestAttemptSnapshot['questions'][number]>()
    for (const row of rows) {
      let question = questionMap.get(row.question_id)
      if (!question) {
        question = {
          id: row.question_id,
          position: row.question_position,
          prompt: row.prompt,
          selectedOptionId: row.selected_option_id,
          options: [],
        }
        questionMap.set(row.question_id, question)
      }
      question.options.push({
        id: row.option_id,
        position: row.option_position,
        label: row.option_label,
      })
    }

    const deadline = attempt.session_ended_at === null
      ? null
      : new Date(attempt.session_ended_at.getTime() + SUBMISSION_GRACE_MS)
    const activeSession = ACTIVE_SESSION_STATUSES.has(attempt.session_status)
    const graded = ['COMPLETED', 'FAILED'].includes(attempt.attempt_status)

    return {
      id: attempt.id,
      aiSessionId: attempt.ai_session_id,
      status: attempt.attempt_status,
      startedAt: attempt.started_at.toISOString(),
      submittedAt: attempt.submitted_at?.toISOString() ?? null,
      completedAt: attempt.completed_at?.toISOString() ?? null,
      submissionDeadline: deadline?.toISOString() ?? null,
      canSubmit: attempt.attempt_status === 'IN_PROGRESS'
        && (activeSession || (deadline !== null && currentTime <= deadline)),
      canRetry: ['FAILED', 'EXPIRED'].includes(attempt.attempt_status)
        && attempt.retry_allowed,
      quest: {
        id: attempt.quest_id,
        code: attempt.code,
        version: attempt.version,
        title: attempt.title,
        passScore: attempt.pass_score,
        rewardPoints: attempt.reward_points,
        retryAllowed: attempt.retry_allowed,
      },
      questions: [...questionMap.values()],
      result: graded && attempt.score !== null && attempt.passed !== null
        ? {
            score: attempt.score,
            passed: attempt.passed,
            retryAllowed: attempt.retry_allowed,
            answerReview: null,
          }
        : null,
    }
  }

  private async getDatabaseTime(manager: EntityManager) {
    const rows = (await manager.query(
      'SELECT clock_timestamp() AS current_time',
    )) as DatabaseTimeRow[]
    return rows[0]?.current_time ?? new Date()
  }

  private notFound(code: string): never {
    throw new NotFoundException({ code })
  }
}
