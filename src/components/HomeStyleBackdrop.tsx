/**
 * 与首页一致的环境光斑：静态柔光 + 与 AuroraBg 同系的缓慢流动色块（animate-aurora-*）。
 * `omitSideGlow`：不渲染贴左右边缘的流动光斑，避免在窄栏（如 AI Chat）里形成两侧竖向色带。
 */
export default function HomeStyleBackdrop({
  className = '',
  omitSideGlow = false,
}: {
  className?: string
  omitSideGlow?: boolean
}) {
  return (
    <div
      className={`pointer-events-none absolute inset-0 -z-10 overflow-hidden ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 opacity-[0.42] blur-3xl">
        <div className="absolute left-1/2 top-[34%] h-64 w-64 -translate-x-1/2 rounded-full bg-violet-600/30" />
        <div className="absolute left-1/2 top-[40%] h-48 w-48 translate-x-[min(12vw,6rem)] rounded-full bg-cyan-500/22" />
      </div>
      {!omitSideGlow && (
        <>
          <div
            className="animate-aurora-1 absolute -left-[10%] top-[12%] h-[min(55vw,420px)] w-[min(55vw,420px)] rounded-full bg-gradient-to-br from-violet-500/18 to-fuchsia-600/10 blur-3xl opacity-55"
            aria-hidden
          />
          <div
            className="animate-aurora-3 absolute -right-[8%] bottom-[8%] h-[min(50vw,380px)] w-[min(50vw,380px)] rounded-full bg-gradient-to-tl from-cyan-500/14 to-sky-600/8 blur-3xl opacity-50"
            aria-hidden
          />
        </>
      )}
    </div>
  )
}
