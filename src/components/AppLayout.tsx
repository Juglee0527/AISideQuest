import { AlertCircle, BarChart3, Compass, House, LoaderCircle, LogIn, Plug, RefreshCw, Sparkles } from 'lucide-react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { useSession } from '../contexts/SessionContext'
import { getGithubLoginUrl } from '../api/apiClient'

const navigationItems = [
  { to: '/', label: 'Home', icon: House },
  { to: '/quests', label: 'Side Quest', icon: Compass },
  { to: '/dashboard', label: 'Dashboard', icon: BarChart3 },
  { to: '/devices', label: 'Devices', icon: Plug },
]

const getNavLinkClassName = ({ isActive }: { isActive: boolean }) =>
  [
    'flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-semibold transition-colors',
    isActive
      ? 'bg-emerald-400/10 text-emerald-300'
      : 'text-slate-400 hover:bg-slate-800 hover:text-slate-100',
  ].join(' ')

function AppLayout() {
  const { activeSessions, loadStatus, errorMessage, retry } = useSession()
  const location = useLocation()
  const isWaitingForUser = activeSessions.some(
    (session) => session.status === 'WAITING_FOR_USER',
  )
  const loginReturnPath = location.pathname.startsWith('/devices/connect/')
    ? location.pathname
    : undefined

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <a
        href="#main-content"
        className="sr-only z-50 rounded-lg bg-emerald-400 px-4 py-2 font-semibold text-slate-950 focus:not-sr-only focus:fixed focus:top-4 focus:left-4"
      >
        본문으로 바로가기
      </a>

      <header className="border-b border-slate-800/80 bg-slate-950/90 backdrop-blur-xl">
        <div className="mx-auto flex h-18 max-w-7xl items-center justify-between px-5 sm:px-8">
          <NavLink to="/" className="flex items-center gap-3" aria-label="AISideQuest Home">
            <span className="grid size-10 place-items-center rounded-2xl bg-emerald-400 text-slate-950 shadow-lg shadow-emerald-950/40">
              <Sparkles size={20} strokeWidth={2.5} aria-hidden="true" />
            </span>
            <span>
              <span className="block text-base font-bold tracking-tight">AISideQuest</span>
              <span className="block text-xs text-slate-500">Make waiting count</span>
            </span>
          </NavLink>

          <nav className="hidden items-center gap-1 md:flex" aria-label="주요 메뉴">
            {navigationItems.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} end={to === '/'} className={getNavLinkClassName}>
                <Icon size={17} aria-hidden="true" />
                {label}
              </NavLink>
            ))}
          </nav>

          {loadStatus === 'loading' ? (
            <span className="flex items-center gap-2 rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-400">
              <LoaderCircle className="animate-spin" size={13} aria-hidden="true" />
              동기화 중
            </span>
          ) : activeSessions.length === 0 ? (
            <span className="rounded-full border border-slate-800 bg-slate-900 px-3 py-1.5 text-xs font-semibold text-slate-400">
              MVP
            </span>
          ) : isWaitingForUser ? (
            <span className="flex items-center gap-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-3 py-1.5 text-xs font-semibold text-amber-200">
              <span className="size-2 animate-pulse rounded-full bg-amber-300" aria-hidden="true" />
              Codex 확인 필요
            </span>
          ) : (
            <span className="flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold text-emerald-300">
              <span className="size-2 animate-pulse rounded-full bg-emerald-400" aria-hidden="true" />
              AI 작업 {activeSessions.length}개
            </span>
          )}
        </div>
      </header>

      <main id="main-content" className="mx-auto max-w-7xl px-5 py-10 pb-28 sm:px-8 md:pb-12 lg:py-14">
        {loadStatus === 'unauthenticated' ? (
          <section
            className="mb-8 flex flex-col gap-4 rounded-2xl border border-amber-400/20 bg-amber-400/5 p-5 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <div className="flex gap-3">
              <LogIn className="mt-0.5 shrink-0 text-amber-300" size={20} aria-hidden="true" />
              <div>
                <p className="font-bold text-amber-100">로그인이 필요합니다.</p>
                <p className="mt-1 text-sm text-amber-100/70">세션 기록은 로그인한 계정의 서버에서 불러옵니다.</p>
              </div>
            </div>
            <a
              href={getGithubLoginUrl(loginReturnPath)}
              data-testid="github-login"
              className="inline-flex shrink-0 items-center justify-center rounded-xl bg-amber-300 px-4 py-2.5 text-sm font-bold text-slate-950 transition hover:bg-amber-200"
            >
              GitHub로 로그인
            </a>
          </section>
        ) : null}

        {loadStatus === 'error' ? (
          <section
            className="mb-8 flex flex-col gap-4 rounded-2xl border border-rose-400/20 bg-rose-400/5 p-5 sm:flex-row sm:items-center sm:justify-between"
            role="alert"
          >
            <div className="flex gap-3">
              <AlertCircle className="mt-0.5 shrink-0 text-rose-300" size={20} aria-hidden="true" />
              <div>
                <p className="font-bold text-rose-100">세션 정보를 동기화하지 못했습니다.</p>
                <p className="mt-1 text-sm text-rose-100/70">{errorMessage}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => void retry()}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl border border-rose-300/30 px-4 py-2.5 text-sm font-bold text-rose-100 transition hover:bg-rose-300/10"
            >
              <RefreshCw size={16} aria-hidden="true" />
              다시 시도
            </button>
          </section>
        ) : null}

        <Outlet />
      </main>

      <nav
        className="fixed inset-x-4 bottom-4 z-40 grid grid-cols-4 gap-1 rounded-2xl border border-slate-700/70 bg-slate-900/95 p-2 shadow-2xl shadow-black/40 backdrop-blur-xl md:hidden"
        aria-label="모바일 주요 메뉴"
      >
        {navigationItems.map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              [
                'flex min-w-0 flex-col items-center gap-1 rounded-xl px-2 py-2 text-[11px] font-semibold transition-colors',
                isActive ? 'bg-emerald-400/10 text-emerald-300' : 'text-slate-500',
              ].join(' ')
            }
          >
            <Icon size={19} aria-hidden="true" />
            <span className="truncate">{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  )
}

export default AppLayout
