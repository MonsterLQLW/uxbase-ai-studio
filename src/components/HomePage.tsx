import { Sparkles, ArrowRight } from 'lucide-react'
import type { Tab } from './Layout'
import HomeStyleBackdrop from './HomeStyleBackdrop'

type HomeNavigate = (tab: Tab) => void

export default function HomePage({ onNavigate }: { onNavigate: HomeNavigate }) {
  return (
    <div className="relative flex h-full min-h-0 flex-col items-center justify-center px-5 py-10 sm:px-8 sm:py-12">
      <HomeStyleBackdrop omitSideGlow />

      <div className="relative z-0 flex w-full max-w-3xl flex-col items-center text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/[0.08] px-4 py-2 text-xs font-medium text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.15)] backdrop-blur-md">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-300" strokeWidth={2} />
          <span>Gemini · TIMI · Creative pipeline</span>
        </div>

        <h1 className="mt-6 font-brand w-full px-1 text-[clamp(2.25rem,7vw,4.5rem)] font-semibold leading-[1.1] tracking-tight sm:mt-7">
          <span className="bg-gradient-to-r from-violet-200 via-white to-cyan-200 bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(139,92,246,0.25)]">
            UXbase AI Studio
          </span>
        </h1>

        <div className="mt-5 w-full max-w-lg sm:mt-6">
          <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1.5 px-4 text-center sm:gap-x-3 sm:px-6">
            <span className="text-[15px] font-medium text-slate-100 sm:text-base">一站式</span>
            <span className="select-none text-slate-600 sm:text-slate-500" aria-hidden>
              ·
            </span>
            <span className="text-[15px] text-slate-300 sm:text-base">
              <span className="font-semibold tracking-wide text-sky-200/95">UX</span>
              资源设计
            </span>
            <span className="select-none text-slate-600 sm:text-slate-500" aria-hidden>
              ·
            </span>
            <span className="text-[15px] text-slate-300 sm:text-base">
              <span className="font-semibold tracking-wide text-violet-200/95">AI</span>
              工作台
            </span>
          </p>
        </div>

        <div className="mt-9 flex flex-col items-stretch gap-3 sm:mt-10 sm:flex-row sm:items-center sm:justify-center sm:gap-4">
          <button
            type="button"
            onClick={() => onNavigate('chat')}
            className="group inline-flex min-h-11 items-center justify-center gap-2 rounded-full bg-white px-8 py-3 text-sm font-semibold text-slate-900 shadow-[0_0_40px_rgba(255,255,255,0.12)] transition hover:bg-slate-100 sm:min-h-0 sm:py-3.5"
          >
            进入工作台
            <ArrowRight className="h-4 w-4 shrink-0 transition group-hover:translate-x-0.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/20 bg-white/[0.06] px-8 py-3 text-sm font-medium text-slate-100 backdrop-blur-md transition hover:border-white/35 hover:bg-white/[0.1] sm:min-h-0 sm:py-3.5"
          >
            连接 API
          </button>
        </div>
      </div>
    </div>
  )
}
