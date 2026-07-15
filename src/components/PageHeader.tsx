import type { ReactNode } from 'react'

interface PageHeaderProps {
  eyebrow: string
  title: string
  description: string
  action?: ReactNode
}

function PageHeader({ eyebrow, title, description, action }: PageHeaderProps) {
  return (
    <header className="flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
      <div className="max-w-3xl">
        <p className="text-sm font-bold tracking-[0.16em] text-emerald-400 uppercase">{eyebrow}</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight text-white sm:text-4xl">{title}</h1>
        <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">{description}</p>
      </div>
      {action}
    </header>
  )
}

export default PageHeader
