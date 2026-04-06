export default function AuroraBg() {
  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none">
      <div className="absolute aurora-aurora-1 w-[600px] h-[600px] 
        bg-gradient-to-br from-indigo-500/20 to-purple-500/20 
        rounded-full blur-3xl top-0 left-0" />
      <div className="absolute aurora-aurora-2 w-[500px] h-[500px] 
        bg-gradient-to-br from-purple-500/20 to-pink-500/20 
        rounded-full blur-3xl top-1/3 right-0" />
      <div className="absolute aurora-aurora-3 w-[400px] h-[400px] 
        bg-gradient-to-br from-cyan-500/20 to-blue-500/20 
        rounded-full blur-3xl bottom-0 left-1/3" />
    </div>
  )
}
