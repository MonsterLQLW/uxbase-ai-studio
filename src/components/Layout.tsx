import { MessageSquare, Settings, Frame, Scissors, Package, Home, Wand2 } from 'lucide-react'
import QclawBrandIcon from './QclawBrandIcon'
import { QCLAW_LOGIN_URL } from '../config'

export type Tab =
  | 'home'
  | 'chat'
  | 'avatar-frame'
  | 'ai-motion'
  | 'ai-matting'
  | 'output-tool'
  | 'settings'

interface NavItemProps {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-medium transition sm:gap-2 sm:px-3 sm:text-xs ${
        active
          ? 'bg-white/15 text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.12)]'
          : 'text-slate-400 hover:bg-white/[0.07] hover:text-slate-200'
      }`}
    >
      {icon}
      <span className="hidden sm:inline">{label}</span>
    </button>
  )
}

interface LayoutProps {
  children: React.ReactNode
  activeTab: Tab
  onTabChange: (tab: Tab) => void
}

export default function Layout({ children, activeTab, onTabChange }: LayoutProps) {
  const isCanvasTab =
    activeTab === 'avatar-frame' ||
    activeTab === 'ai-matting' ||
    activeTab === 'output-tool'
  const isChatTab = activeTab === 'chat'
  const isHomeTab = activeTab === 'home'
  const isSettingsTab = activeTab === 'settings'
  const isMattingTab = activeTab === 'ai-matting'
  const isAiMotionTab = activeTab === 'ai-motion'

  return (
    <div className="relative z-10 flex h-screen flex-col bg-transparent text-slate-200">
      <header className="shrink-0 px-3 pb-1.5 pt-3 sm:px-5">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 rounded-full border border-white/[0.08] bg-slate-950/35 px-2.5 py-1.5 shadow-[0_6px_28px_rgba(0,0,0,0.4)] backdrop-blur-xl sm:flex-row sm:items-center sm:justify-between sm:gap-3 sm:px-4 sm:py-2">
          <button
            type="button"
            onClick={() => onTabChange('home')}
            className="font-brand shrink-0 text-left text-lg font-semibold leading-tight tracking-tight text-white sm:text-xl"
            title="首页"
          >
            <span className="bg-gradient-to-r from-violet-200 via-white to-cyan-200 bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(139,92,246,0.3)]">
              UXbase AI Studio
            </span>
          </button>

          <nav className="flex flex-1 flex-wrap items-center justify-center gap-1.5 sm:justify-end sm:gap-2 md:gap-2.5">
            <NavItem
              icon={<Home size={14} />}
              label="首页"
              active={activeTab === 'home'}
              onClick={() => onTabChange('home')}
            />
            <NavItem
              icon={<MessageSquare size={14} />}
              label="AI Chat"
              active={activeTab === 'chat'}
              onClick={() => onTabChange('chat')}
            />
            <NavItem
              icon={<Frame size={14} />}
              label="AI创作"
              active={activeTab === 'avatar-frame'}
              onClick={() => onTabChange('avatar-frame')}
            />
            <NavItem
              icon={<Wand2 size={14} />}
              label="AI动效"
              active={activeTab === 'ai-motion'}
              onClick={() => onTabChange('ai-motion')}
            />
            <NavItem
              icon={<Scissors size={14} />}
              label="智能抠图"
              active={activeTab === 'ai-matting'}
              onClick={() => onTabChange('ai-matting')}
            />
            <NavItem
              icon={<Package size={14} />}
              label="输出工具"
              active={activeTab === 'output-tool'}
              onClick={() => onTabChange('output-tool')}
            />
            <NavItem
              icon={<Settings size={14} />}
              label="Settings"
              active={activeTab === 'settings'}
              onClick={() => onTabChange('settings')}
            />
          </nav>

          <a
            href={QCLAW_LOGIN_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-auto flex shrink-0 items-center gap-1.5 self-end rounded-full bg-rose-500/[0.1] px-2 py-1.5 text-rose-50/95 shadow-[0_0_22px_rgba(251,113,133,0.12)] backdrop-blur-sm transition hover:bg-rose-500/[0.18] hover:text-white sm:self-auto sm:ml-2 sm:px-2.5 lg:ml-3"
            title="QClaw 已打通 · 打开登录"
          >
            <QclawBrandIcon className="h-[18px] w-[18px] shrink-0 sm:h-5 sm:w-5" />
            <span className="hidden text-[10px] font-medium tracking-wide text-rose-100/90 sm:inline sm:text-[11px]">
              QClaw
            </span>
          </a>
        </div>
      </header>

      <main
        className={`relative min-h-0 flex-1 ${
          isHomeTab ? 'overflow-y-auto overflow-x-hidden' : 'overflow-hidden'
        } ${
          isHomeTab || isChatTab || isSettingsTab || isMattingTab || isAiMotionTab
            ? ''
            : 'bg-slate-950/[0.86] backdrop-blur-md'
        }`}
      >
        <div
          className={
            isMattingTab
              ? 'relative flex h-full min-h-0 w-full flex-col px-3 pb-3 pt-2 sm:px-5 sm:pb-4 sm:pt-3'
              : isCanvasTab
                ? `h-full min-h-0 w-full ${activeTab === 'output-tool' ? 'bg-slate-950/40' : 'bg-slate-950'}`
                : isChatTab
                  ? 'relative mx-auto flex h-full min-h-0 w-full max-w-[47.92rem] flex-col px-4 pb-[4.887rem] pt-6 sm:max-w-[55.91rem] sm:px-5 sm:pb-[5.7rem] sm:pt-8'
                  : isHomeTab
                    ? 'mx-auto flex w-full max-w-6xl flex-col px-5 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-6'
                    : isSettingsTab
                      ? 'relative mx-auto flex h-full min-h-0 w-full max-w-none flex-col px-5 pb-10 pt-6 sm:px-8 sm:pb-12 sm:pt-8'
                      : isAiMotionTab
                        ? 'relative mx-auto flex h-full min-h-0 w-full max-w-5xl flex-col px-4 py-4 sm:px-6 sm:py-6'
                        : 'mx-auto h-full min-h-0 max-w-7xl px-6 py-8'
          }
        >
          {children}
        </div>
      </main>
    </div>
  )
}
