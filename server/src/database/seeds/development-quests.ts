import type { DataSource, EntityManager } from 'typeorm'

import AppDataSource from '../data-source'

interface DevelopmentQuestSeed {
  code: string
  title: string
  description: string
  question: string
  options: readonly string[]
  correctOption: number
}

const DEVELOPMENT_QUESTS: readonly DevelopmentQuestSeed[] = [
  {
    code: 'typescript-type-narrowing',
    title: 'TypeScript 타입 좁히기',
    description: '런타임 검사로 union 타입을 안전하게 좁히는 방법을 확인합니다.',
    question: '`string | number` 값을 문자열로 좁히는 가장 명시적인 검사는 무엇인가요?',
    options: [
      "typeof value === 'string'",
      "value === String",
      "value instanceof 'string'",
      'Boolean(value)',
    ],
    correctOption: 0,
  },
  {
    code: 'http-idempotency',
    title: 'HTTP 멱등성',
    description: '재시도 가능한 변경 요청을 안전하게 처리하는 기준을 확인합니다.',
    question: '같은 결제 요청의 네트워크 재시도로 중복 처리를 막는 핵심 수단은 무엇인가요?',
    options: [
      '요청마다 같은 멱등성 키를 보내고 서버에서 결과를 저장합니다.',
      '클라이언트 버튼을 1초 동안 비활성화합니다.',
      '응답 시간을 의도적으로 늦춥니다.',
      '모든 요청을 GET으로 전환합니다.',
    ],
    correctOption: 0,
  },
  {
    code: 'postgresql-unique-constraint',
    title: 'PostgreSQL 유일성 제약',
    description: '동시 요청에서도 중복 데이터를 막는 데이터베이스 제약을 확인합니다.',
    question: '동시에 들어온 두 요청에서도 같은 이메일 저장을 확실히 막는 방법은 무엇인가요?',
    options: [
      '애플리케이션 조회 후 INSERT만 수행합니다.',
      '데이터베이스 UNIQUE 제약을 정의합니다.',
      '화면에서 중복 확인 버튼을 제공합니다.',
      '이메일을 메모리에 캐시합니다.',
    ],
    correctOption: 1,
  },
  {
    code: 'git-safe-history',
    title: 'Git 안전한 이력 관리',
    description: '공유 브랜치의 변경을 안전하게 되돌리는 방법을 확인합니다.',
    question: '이미 공유된 커밋을 이력을 보존하며 되돌릴 때 적합한 명령은 무엇인가요?',
    options: ['git reset --hard', 'git clean -fd', 'git revert', 'git stash drop'],
    correctOption: 2,
  },
  {
    code: 'testing-boundary-values',
    title: '경계값 테스트',
    description: '입력 범위의 오류를 찾기 위한 기본 테스트 구성을 확인합니다.',
    question: '0부터 100까지 허용되는 점수 입력의 경계 테스트로 가장 적절한 묶음은 무엇인가요?',
    options: [
      '50만 테스트합니다.',
      '0과 100만 테스트합니다.',
      '-1, 0, 100, 101을 테스트합니다.',
      '임의 문자열 하나만 테스트합니다.',
    ],
    correctOption: 2,
  },
]

async function findOrCreateQuest(
  manager: EntityManager,
  seed: DevelopmentQuestSeed,
) {
  await manager.query(
    `
      INSERT INTO quests (
        code, version, type, status, title, description,
        estimated_minutes, reward_points, pass_score, published_at
      )
      VALUES ($1, 1, 'MULTIPLE_CHOICE', 'PUBLISHED', $2, $3, 2, 100, 100, $4)
      ON CONFLICT (code, version) DO NOTHING
    `,
    [seed.code, seed.title, seed.description, '2026-07-16T00:00:00.000Z'],
  )

  const rows = (await manager.query(
    'SELECT id FROM quests WHERE code = $1 AND version = 1',
    [seed.code],
  )) as Array<{ id: string }>

  if (!rows[0]) {
    throw new Error(`Failed to find seeded quest: ${seed.code}`)
  }

  return rows[0].id
}

async function findOrCreateQuestion(
  manager: EntityManager,
  questId: string,
  prompt: string,
) {
  await manager.query(
    `
      INSERT INTO quest_questions (quest_id, position, prompt)
      VALUES ($1, 1, $2)
      ON CONFLICT (quest_id, position) DO NOTHING
    `,
    [questId, prompt],
  )

  const rows = (await manager.query(
    'SELECT id FROM quest_questions WHERE quest_id = $1 AND position = 1',
    [questId],
  )) as Array<{ id: string }>

  if (!rows[0]) {
    throw new Error(`Failed to find seeded question for quest: ${questId}`)
  }

  return rows[0].id
}

async function seedOptions(
  manager: EntityManager,
  questionId: string,
  seed: DevelopmentQuestSeed,
) {
  for (const [optionIndex, label] of seed.options.entries()) {
    await manager.query(
      `
        INSERT INTO quest_options (
          question_id, position, label, is_correct
        )
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (question_id, position) DO NOTHING
      `,
      [questionId, optionIndex + 1, label, optionIndex === seed.correctOption],
    )
  }
}

export async function seedDevelopmentQuests(dataSource: DataSource) {
  await dataSource.transaction(async (manager) => {
    for (const seed of DEVELOPMENT_QUESTS) {
      const questId = await findOrCreateQuest(manager, seed)
      const questionId = await findOrCreateQuestion(
        manager,
        questId,
        seed.question,
      )

      await seedOptions(manager, questionId, seed)
    }
  })
}

async function run() {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Development quest seed cannot run in production')
  }

  await AppDataSource.initialize()

  try {
    await seedDevelopmentQuests(AppDataSource)
  } finally {
    await AppDataSource.destroy()
  }
}

if (require.main === module) {
  void run().catch((error: unknown) => {
    console.error(error)
    process.exitCode = 1
  })
}
