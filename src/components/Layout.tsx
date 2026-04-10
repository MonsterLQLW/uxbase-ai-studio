import { MessageSquare, Settings, Frame, Scissors, Package, Home } from 'lucide-react'

export type Tab = 'home' | 'chat' | 'avatar-frame' | 'ai-matting' | 'output-tool' | 'settings'

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

          <div className="hidden whitespace-nowrap text-[9px] tracking-wide text-slate-500 lg:ml-1 lg:block lg:shrink-0 lg:pl-4">
            Gemini · TIMI
          </div>
        </div>
      </header>

      <main
        className={`relative min-h-0 flex-1 overflow-hidden ${isHomeTab ? '' : 'bg-slate-950/[0.86] backdrop-blur-md'}`}
      >
        <div
          className={
            isCanvasTab
              ? 'h-full min-h-0 w-full bg-slate-950'
              : isChatTab
                ? 'mx-auto h-full min-h-0 max-w-7xl px-6 pb-10 pt-8'
                : isHomeTab
                  ? 'mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col px-5 pb-10 pt-6 sm:px-8 sm:pb-12 sm:pt-8'
                  : 'mx-auto h-full min-h-0 max-w-7xl px-6 py-8'
          }
        >
          {children}
        </div>
      </main>
    </div>
  )
}
