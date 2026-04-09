import { MessageSquare, Settings, Frame, Scissors, Package } from 'lucide-react'

type Tab = 'chat' | 'avatar-frame' | 'ai-matting' | 'output-tool' | 'settings'

interface NavItemProps {
  icon: React.ReactNode
  label: string
  active?: boolean
  onClick?: () => void
}

function NavItem({ icon, label, active, onClick }: NavItemProps) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors ${
        active
          ? 'bg-blue-600 text-white'
          : 'text-slate-400 hover:bg-slate-800 hover:text-slate-200'
      }`}
    >
      {icon}
      <span>{label}</span>
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
  return (
    <div className="flex flex-col h-screen bg-slate-950 text-slate-200">
      {/* 顶部导航 */}
      <header className="bg-slate-900 border-b border-slate-800 px-6 py-4">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <h1 className="text-xl font-bold text-blue-400">UXbase AI Studio</h1>
          <nav className="flex space-x-6">
            <NavItem
              icon={<MessageSquare size={18} />}
              label="AI Chat"
              active={activeTab === 'chat'}
              onClick={() => onTabChange('chat')}
            />
            <NavItem
              icon={<Frame size={18} />}
              label="头像框设计"
              active={activeTab === 'avatar-frame'}
              onClick={() => onTabChange('avatar-frame')}
            />
            <NavItem
              icon={<Scissors size={18} />}
              label="AI matting"
              active={activeTab === 'ai-matting'}
              onClick={() => onTabChange('ai-matting')}
            />
            <NavItem
              icon={<Package size={18} />}
              label="输出工具"
              active={activeTab === 'output-tool'}
              onClick={() => onTabChange('output-tool')}
            />
            <NavItem
              icon={<Settings size={18} />}
              label="Settings"
              active={activeTab === 'settings'}
              onClick={() => onTabChange('settings')}
            />
          </nav>
          <div className="text-xs text-slate-500">
            Gemini 2.0 Flash · Free Tier
          </div>
        </div>
      </header>

      {/* 主内容 */}
      <main className="flex-1 overflow-hidden">
        <div className={isCanvasTab ? 'w-full h-full' : 'max-w-7xl mx-auto px-6 py-8 h-full'}>{children}</div>
      </main>
    </div>
  )
}
