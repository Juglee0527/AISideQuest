import type { Quest } from '../types/quest'

export const mockQuests = [
  {
    id: 'survey-ai-workflow',
    title: 'AI 작업 경험 설문',
    description: 'AI 도구 사용 경험을 돌아보는 간단한 5문항 설문입니다.',
    reward: 500,
    estimatedMinutes: 3,
  },
  {
    id: 'quiz-typescript-basics',
    title: 'TypeScript 기본 퀴즈',
    description: 'TypeScript의 기본 개념을 확인하는 3문항 개발 퀴즈입니다.',
    reward: 100,
    estimatedMinutes: 2,
  },
  {
    id: 'learning-developer-words',
    title: '개발 영어 단어 학습',
    description: '개발 문서에서 자주 쓰는 영어 단어 5개를 학습합니다.',
    reward: 80,
    estimatedMinutes: 4,
  },
  {
    id: 'news-ai-briefing',
    title: 'AI·개발 뉴스 읽기',
    description: '오늘의 AI와 개발 분야 주요 소식을 짧게 읽습니다.',
    reward: 50,
    estimatedMinutes: 5,
  },
  {
    id: 'microtask-copy-review',
    title: 'UI 문구 검토',
    description: '짧은 UI 문구의 자연스러움과 오탈자를 검토하는 마이크로태스크입니다.',
    reward: 200,
    estimatedMinutes: 7,
  },
] as const satisfies readonly Quest[]
