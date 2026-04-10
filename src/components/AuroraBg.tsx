import ParticleFlow from './ParticleFlow'

export default function AuroraBg() {
  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden">
      <div
        className="absolute inset-0 bg-gradient-to-b from-[#08051a] via-[#0a0618] to-[#030208]"
        aria-hidden
      />
      <div
        className="animate-aurora-1 absolute left-0 top-0 h-[min(90vw,640px)] w-[min(90vw,640px)] rounded-full bg-gradient-to-br from-violet-600/12 to-indigo-600/7 blur-3xl"
        aria-hidden
      />
      <div
        className="animate-aurora-2 absolute right-0 top-1/4 h-[min(80vw,520px)] w-[min(80vw,520px)] rounded-full bg-gradient-to-bl from-fuchsia-500/10 to-purple-600/5 blur-3xl"
        aria-hidden
      />
      <div
        className="animate-aurora-3 absolute bottom-0 left-1/4 h-[min(70vw,480px)] w-[min(70vw,480px)] rounded-full bg-gradient-to-tr from-cyan-500/9 to-blue-600/5 blur-3xl"
        aria-hidden
      />
      <div className="absolute inset-0 opacity-[0.74]">
        <ParticleFlow />
      </div>
    </div>
  )
}
