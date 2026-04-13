/**
 * AI 动效占位页：与首页相同的全局 Aurora + ParticleFlow 波点呼吸（由 App 层 AuroraBg 提供），此处仅叠内容。
 */
export default function AiMotionPlaceholder() {
  return (
    <div className="relative z-10 flex h-full min-h-0 w-full flex-col items-center justify-center px-5 py-10">
      <div className="max-w-md rounded-2xl border border-white/[0.1] bg-slate-950/40 px-8 py-10 text-center shadow-[0_12px_48px_rgba(0,0,0,0.35)] backdrop-blur-md">
        <p className="font-brand text-xs font-medium tracking-[0.2em] text-violet-300/80">AI Motion</p>
        <h1 className="font-brand mt-3 text-2xl font-semibold tracking-tight text-white sm:text-3xl">AI 动效</h1>
        <p className="mt-5 text-sm font-medium leading-relaxed tracking-wide text-slate-200/95 sm:mt-6 sm:text-base">
          UX资源·AI动效提效制作
        </p>
        <p className="mt-8 text-[11px] leading-relaxed text-slate-500/65 sm:mt-10 sm:text-xs">功能搭建中</p>
      </div>
    </div>
  )
}
