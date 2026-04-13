import { useEffect, useState } from 'react'
import { Sparkles, ArrowRight, Frame, MessageSquare, Scissors, Package, Plus } from 'lucide-react'
import type { Tab } from './Layout'
import HomeStyleBackdrop from './HomeStyleBackdrop'
import {
  formatArchiveCornerDate,
  PENDING_RESTORE_HISTORY_ID_KEY,
  type HistoryEntry,
} from '../lib/stateHistory'
import {
  buildHomeArchiveGrid,
  setPendingWorkspaceNav,
  type HomeGridItem,
  type WorkspaceSnapshot,
  type WorkspacePinSource,
} from '../lib/homeWorkspaceSnapshots'

type HomeNavigate = (tab: Tab) => void

function sourceLabel(source: WorkspacePinSource): string {
  switch (source) {
    case 'avatar-frame':
      return 'AI 创作 · 工作区'
    case 'chat':
      return 'AI Chat · 工作区'
    case 'ai-matting':
      return '智能抠图 · 工作区'
    case 'output-tool':
      return '输出工具 · 工作区'
    default:
      return '工作区'
  }
}

/** 横向略扁的存档卡片比例（底部一行 4 格） */
const ARCHIVE_CARD_ASPECT = 'aspect-[2.25/1]'

const cardShell =
  `relative w-full min-w-0 overflow-hidden rounded-xl border text-left transition ${ARCHIVE_CARD_ASPECT}`

function PlaceholderIcon({ source }: { source: WorkspacePinSource }) {
  const cls = 'h-6 w-6 text-violet-200/75 sm:h-7 sm:w-7'
  switch (source) {
    case 'avatar-frame':
      return <Frame className={cls} strokeWidth={1.25} />
    case 'chat':
      return <MessageSquare className={cls} strokeWidth={1.25} />
    case 'ai-matting':
      return <Scissors className={cls} strokeWidth={1.25} />
    case 'output-tool':
      return <Package className={cls} strokeWidth={1.25} />
    default:
      return <Frame className={cls} strokeWidth={1.25} />
  }
}

function WorkspaceArchiveCard({ snap, onOpen }: { snap: WorkspaceSnapshot; onOpen: () => void }) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group ${cardShell} border-white/[0.08] bg-slate-950/60 shadow-[0_2px_14px_rgba(0,0,0,0.2)] hover:border-violet-400/28 hover:shadow-[0_4px_20px_rgba(99,102,241,0.1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50`}
    >
      {snap.thumbDataUrl ? (
        <img
          src={snap.thumbDataUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950/90 via-slate-900 to-cyan-950/80">
          <div className="absolute inset-0 flex items-center justify-center opacity-40 transition group-hover:opacity-55">
            <PlaceholderIcon source={snap.source} />
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/80 via-black/35 to-transparent" />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-center px-2 py-1.5 sm:px-2.5">
        <p className="line-clamp-1 text-[9px] font-semibold leading-tight text-white/95 drop-shadow sm:text-[10px]">
          {snap.title}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[8px] text-white/50 sm:text-[9px]">{sourceLabel(snap.source)}</p>
        <p className="mt-0.5 line-clamp-1 text-[8px] text-white/35 sm:text-[9px]">{snap.subtitle}</p>
      </div>

      <div className="pointer-events-none absolute bottom-1 right-1.5 text-[8px] tabular-nums text-white/65 drop-shadow sm:bottom-1.5 sm:text-[9px]">
        {formatArchiveCornerDate(snap.updatedAt)}
      </div>
    </button>
  )
}

const EMPTY_SLOT_HINTS: { hint: string }[] = [
  { hint: 'AI 创作' },
  { hint: 'AI Chat' },
  { hint: '智能抠图' },
  { hint: '输出工具' },
]

function ArchiveEmptySlot({ hint }: { hint: string }) {
  return (
    <div
      className={`flex ${ARCHIVE_CARD_ASPECT} w-full min-w-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-white/[0.08] bg-white/[0.03]`}
    >
      <Plus className="h-4 w-4 text-slate-500/35 sm:h-[18px] sm:w-[18px]" strokeWidth={1.75} aria-hidden />
      <span className="text-[7px] font-medium tracking-[0.1em] text-slate-500/45 sm:text-[8px]">待填充</span>
      <span className="text-[8px] text-slate-500/32 sm:text-[9px]">{hint}</span>
    </div>
  )
}

function HistoryArchiveCard({ entry, onOpen }: { entry: HistoryEntry; onOpen: () => void }) {
  const kind = entry.auto ? '自动保存' : '手动存档'
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`group ${cardShell} border-white/[0.08] bg-slate-950/60 shadow-[0_2px_14px_rgba(0,0,0,0.2)] hover:border-violet-400/28 hover:shadow-[0_4px_20px_rgba(99,102,241,0.1)] focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-400/50`}
    >
      {entry.thumbDataUrl ? (
        <img
          src={entry.thumbDataUrl}
          alt=""
          className="absolute inset-0 h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
        />
      ) : (
        <div className="absolute inset-0 bg-gradient-to-br from-violet-950/90 via-slate-900 to-cyan-950/80">
          <div className="absolute inset-0 flex items-center justify-center opacity-40 transition group-hover:opacity-55">
            <Frame className="h-6 w-6 text-violet-200/85 sm:h-7 sm:w-7" strokeWidth={1.25} />
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-0 bg-gradient-to-r from-black/80 via-black/35 to-transparent" />

      <div className="pointer-events-none absolute inset-0 flex flex-col justify-center px-2 py-1.5 sm:px-2.5">
        <p className="line-clamp-1 text-[9px] font-semibold leading-tight text-white/95 drop-shadow sm:text-[10px]">
          {entry.name}
        </p>
        <p className="mt-0.5 line-clamp-1 text-[8px] text-white/50 sm:text-[9px]">AI 创作 · {kind}</p>
      </div>

      <div className="pointer-events-none absolute bottom-1 right-1.5 text-[8px] tabular-nums text-white/65 drop-shadow sm:bottom-1.5 sm:text-[9px]">
        {formatArchiveCornerDate(entry.timestamp)}
      </div>
    </button>
  )
}

export default function HomePage({
  onNavigate,
  homeRefreshKey,
}: {
  onNavigate: HomeNavigate
  homeRefreshKey: number
}) {
  const [items, setItems] = useState<HomeGridItem[]>(() => buildHomeArchiveGrid())

  useEffect(() => {
    setItems(buildHomeArchiveGrid())
  }, [homeRefreshKey])

  useEffect(() => {
    const bump = () => setItems(buildHomeArchiveGrid())
    window.addEventListener('ux-workspace-snap-updated', bump)
    window.addEventListener('storage', bump)
    return () => {
      window.removeEventListener('ux-workspace-snap-updated', bump)
      window.removeEventListener('storage', bump)
    }
  }, [])

  const openHistory = (entry: HistoryEntry) => {
    try {
      sessionStorage.setItem(PENDING_RESTORE_HISTORY_ID_KEY, entry.id)
    } catch {
      /* ignore */
    }
    onNavigate('avatar-frame')
  }

  const openWorkspace = (snap: WorkspaceSnapshot) => {
    if (snap.source === 'avatar-frame') {
      onNavigate('avatar-frame')
      return
    }
    setPendingWorkspaceNav(snap.source)
    if (snap.source === 'chat') onNavigate('chat')
    else if (snap.source === 'ai-matting') onNavigate('ai-matting')
    else if (snap.source === 'output-tool') onNavigate('output-tool')
  }

  return (
    <div className="relative flex w-full flex-col">
      <HomeStyleBackdrop omitSideGlow />

      <div className="relative z-0 flex w-full flex-col items-center justify-center px-3 py-10 text-center sm:px-6 sm:py-14">
        <div className="inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/[0.08] px-4 py-2 text-xs font-medium text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.14)] backdrop-blur-md sm:px-5 sm:py-2.5 sm:text-sm">
          <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-300 sm:h-4 sm:w-4" strokeWidth={2} />
          <span>Gemini · TIMI · Creative pipeline</span>
        </div>

        <h1 className="font-brand mx-auto mt-6 w-full max-w-4xl px-2 text-center text-[clamp(2.1rem,7.5vw,3.75rem)] font-semibold leading-[1.08] tracking-tight sm:mt-8">
          <span className="inline-block bg-gradient-to-r from-violet-200 via-white to-cyan-200 bg-clip-text text-transparent drop-shadow-[0_0_40px_rgba(139,92,246,0.24)]">
            UXbase AI Studio
          </span>
        </h1>

        <div className="mx-auto mt-4 w-full max-w-2xl sm:mt-5">
          <p className="flex flex-wrap items-center justify-center gap-x-2.5 gap-y-1.5 px-3 text-center text-base text-slate-200 sm:gap-x-3 sm:text-lg">
            <span className="font-medium text-slate-100">一站式</span>
            <span className="select-none text-slate-600 sm:text-slate-500" aria-hidden>
              ·
            </span>
            <span className="text-slate-300">
              <span className="font-semibold tracking-wide text-sky-200/95">UX</span>
              设计&输出
            </span>
            <span className="select-none text-slate-600 sm:text-slate-500" aria-hidden>
              ·
            </span>
            <span className="text-slate-300">
              <span className="font-semibold tracking-wide text-violet-200/95">AI</span>
              工作台
            </span>
          </p>
        </div>

        <div className="mt-8 flex w-full max-w-md flex-col items-stretch gap-3 sm:mt-10 sm:max-w-none sm:flex-row sm:items-center sm:justify-center sm:gap-4">
          <button
            type="button"
            onClick={() => onNavigate('chat')}
            className="group inline-flex min-h-12 items-center justify-center gap-2 rounded-full bg-white px-9 py-3.5 text-base font-semibold text-slate-900 shadow-[0_0_40px_rgba(255,255,255,0.12)] transition hover:bg-slate-100 sm:min-h-0 sm:px-10 sm:py-4"
          >
            进入工作台
            <ArrowRight className="h-5 w-5 shrink-0 transition group-hover:translate-x-0.5" strokeWidth={2.5} />
          </button>
          <button
            type="button"
            onClick={() => onNavigate('settings')}
            className="inline-flex min-h-12 items-center justify-center rounded-full border border-white/20 bg-white/[0.06] px-9 py-3.5 text-base font-medium text-slate-100 backdrop-blur-md transition hover:border-white/35 hover:bg-white/[0.1] sm:min-h-0 sm:px-10 sm:py-4"
          >
            连接 API
          </button>
        </div>
      </div>

      {/* 主视觉与存档区间隔约 5% 视口高度，顶区更透气、存档整体下移 */}
      <div className="h-[5vh] min-h-4 shrink-0" aria-hidden />

      <section
        className="relative z-0 w-full px-2 pb-10 pt-2 sm:px-4 sm:pb-14 sm:pt-3"
        aria-labelledby="home-archives-heading"
      >
        <div className="mx-auto w-full max-w-5xl">
          <h2
            id="home-archives-heading"
            className="text-center text-[10px] font-medium tracking-[0.2em] text-slate-500/95 sm:text-[11px]"
          >
            项目存档
          </h2>
          <p className="mx-auto mt-1.5 max-w-lg px-2 text-center text-[10px] leading-relaxed text-slate-500/75 sm:text-[11px]">
            项目自动存档 · 点击真实存档可返回对应工具
          </p>

          <ul
            className="mt-4 grid grid-cols-2 gap-2 sm:mt-5 sm:grid-cols-4 sm:gap-2.5"
            role="list"
          >
            {[0, 1, 2, 3].map((i) => {
              const item = items[i]
              const hint = EMPTY_SLOT_HINTS[i]?.hint ?? '待填充'
              if (!item) {
                return (
                  <li key={`row1-slot-${i}`} className="min-w-0">
                    <ArchiveEmptySlot hint={hint} />
                  </li>
                )
              }
              return (
                <li key={item.cardKey} className="min-w-0">
                  {item.kind === 'workspace' ? (
                    <WorkspaceArchiveCard snap={item.snap} onOpen={() => openWorkspace(item.snap)} />
                  ) : (
                    <HistoryArchiveCard entry={item.entry} onOpen={() => openHistory(item.entry)} />
                  )}
                </li>
              )
            })}
            {items.slice(4).map((item) => (
              <li key={item.cardKey} className="min-w-0">
                {item.kind === 'workspace' ? (
                  <WorkspaceArchiveCard snap={item.snap} onOpen={() => openWorkspace(item.snap)} />
                ) : (
                  <HistoryArchiveCard entry={item.entry} onOpen={() => openHistory(item.entry)} />
                )}
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  )
}
