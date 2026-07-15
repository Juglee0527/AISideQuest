import type { LucideIcon } from 'lucide-react'

interface StatCardProps {
  label: string
  value: string
  helper: string
  icon: LucideIcon
  accent?: 'emerald' | 'sky' | 'violet' | 'amber'
}

const accentClassNames = {
  emerald: 'bg-emerald-400/10 text-emerald-300',
  sky: 'bg-sky-400/10 text-sky-300',
  violet: 'bg-violet-400/10 text-violet-300',
  amber: 'bg-amber-400/10 text-amber-300',
}

function StatCard({ label, value, helper, icon: Icon, accent = 'emerald' }: StatCardProps) {
  return (
    <article className="rounded-2xl border border-slate-800 bg-slate-900/70 p-5 shadow-lg shadow-black/10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-slate-400">{label}</p>
          <p className="mt-3 text-2xl font-bold tracking-tight text-white">{value}</p>
        </div>
        <span className={`grid size-10 shrink-0 place-items-center rounded-xl ${accentClassNames[accent]}`}>
          <Icon size={19} aria-hidden="true" />
        </span>
      </div>
      <p className="mt-4 text-xs leading-5 text-slate-500">{helper}</p>
    </article>
  )
}

export default StatCard
