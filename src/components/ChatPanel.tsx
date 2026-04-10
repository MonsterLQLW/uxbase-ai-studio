import { useState, useRef } from 'react'
import { chatWithGemini, chatWithTIMI, type ChatMessage } from '../services/gemini'
import { Send, Image as ImageIcon, Loader, Sparkles } from 'lucide-react'
import HomeStyleBackdrop from './HomeStyleBackdrop'

type ChatModel = 'gemini' | 'timi'

export default function ChatPanel() {
  const [input, setInput] = useState('')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [chatModel, setChatModel] = useState<ChatModel>('gemini')
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bottomRef = useRef<HTMLDivElement>(null)

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      setSelectedImage(ev.target?.result as string)
    }
    reader.readAsDataURL(file)
  }

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const send = async () => {
    if (!input.trim() && !selectedImage) return

    const userMsg: ChatMessage = {
      role: 'user',
      text: input || '[发送了一张图片]',
      imageData: selectedImage || undefined,
    }
    setMessages(prev => [...prev, userMsg])
    setInput('')
    setSelectedImage(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
    setLoading(true)
    scrollToBottom()

    try {
      let replyText: string
      if (chatModel === 'timi') {
        replyText = await chatWithTIMI([...messages, userMsg])
      } else {
        replyText = await chatWithGemini([...messages, userMsg])
      }
      setMessages(prev => [...prev, { role: 'model', text: replyText }])
    } catch (e: any) {
      const errMsg = e?.message?.includes('API_KEY')
        ? 'API Key 未配置，请打开设置页填写'
        : `出错了: ${e?.message || '未知错误'}`
      setMessages(prev => [...prev, { role: 'model', text: errMsg }])
    }
    setLoading(false)
    scrollToBottom()
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <HomeStyleBackdrop omitSideGlow />

      <div className="relative z-0 flex min-h-0 flex-1 flex-col">
        <div
          className={`min-h-0 flex-1 overflow-y-auto pb-4 pr-1 [scrollbar-color:rgba(100,116,139,0.5)_transparent] ${
            messages.length === 0 ? 'flex flex-col' : 'space-y-4'
          }`}
        >
          {messages.length === 0 ? (
            <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4 py-6 text-center">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-violet-400/25 bg-violet-500/[0.08] px-4 py-2 text-xs font-medium text-violet-100 shadow-[0_0_24px_rgba(139,92,246,0.15)] backdrop-blur-md">
                <Sparkles className="h-3.5 w-3.5 shrink-0 text-violet-300" strokeWidth={2} />
                <span>Gemini · TIMI · 对话工作台</span>
              </div>
              <h2 className="font-brand bg-gradient-to-r from-violet-200 via-white to-cyan-200 bg-clip-text text-3xl font-semibold tracking-tight text-transparent drop-shadow-[0_0_28px_rgba(139,92,246,0.2)] sm:text-4xl">
                AI Chat
              </h2>
              <p className="mt-3 max-w-md text-sm leading-relaxed text-slate-400 sm:text-[15px]">
                可对话智能助手 · 分析风格&数据 · 智能生成
              </p>
            </div>
          ) : (
            <>
              {messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div
                    className={`max-w-[min(100%,28rem)] px-4 py-3 ${
                      m.role === 'user'
                        ? 'rounded-2xl rounded-br-md border border-white/15 bg-gradient-to-br from-indigo-500/95 via-violet-600/90 to-indigo-600/95 text-white shadow-[0_12px_40px_rgba(99,102,241,0.35)]'
                        : 'rounded-2xl rounded-bl-md border border-white/[0.09] bg-slate-950/45 text-slate-200 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md ring-1 ring-white/[0.04]'
                    }`}
                  >
                    {m.imageData && (
                      <img
                        src={m.imageData}
                        alt="上传图片"
                        className="mb-2 max-h-60 max-w-full rounded-lg object-contain ring-1 ring-white/10"
                      />
                    )}
                    <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>
                  </div>
                </div>
              ))}
              {loading && (
                <div className="flex justify-start">
                  <div className="flex items-center gap-2 rounded-2xl rounded-bl-md border border-white/[0.09] bg-slate-950/45 px-4 py-3 text-slate-400 shadow-[0_8px_32px_rgba(0,0,0,0.35)] backdrop-blur-md ring-1 ring-white/[0.04]">
                    <Loader size={16} className="animate-spin text-violet-300" />
                    <span className="text-sm text-slate-300">思考中...</span>
                  </div>
                </div>
              )}
              <div ref={bottomRef} />
            </>
          )}
        </div>

        {selectedImage && (
          <div className="relative z-[1] mb-2 flex flex-shrink-0 items-center gap-3 rounded-xl border border-white/10 bg-slate-950/40 p-2 backdrop-blur-md">
            <img src={selectedImage} alt="预览" className="h-16 rounded-lg object-cover ring-1 ring-white/10" />
            <button
              type="button"
              onClick={() => setSelectedImage(null)}
              className="rounded-full border border-red-400/30 bg-red-500/20 px-3 py-1 text-xs font-medium text-red-200 transition hover:bg-red-500/30"
            >
              移除
            </button>
          </div>
        )}

        <div className="relative z-[1] mt-2 mb-1 flex flex-shrink-0 flex-col gap-3 sm:mb-2">
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setChatModel('gemini')}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                chatModel === 'gemini'
                  ? 'border border-violet-400/35 bg-violet-500/20 text-violet-100 shadow-[0_0_20px_rgba(139,92,246,0.2)]'
                  : 'border border-white/10 bg-white/[0.05] text-slate-400 hover:border-white/20 hover:bg-white/[0.08] hover:text-slate-200'
              }`}
            >
              ✨ Gemini
            </button>
            <button
              type="button"
              onClick={() => setChatModel('timi')}
              className={`rounded-full px-3.5 py-1.5 text-xs font-medium transition ${
                chatModel === 'timi'
                  ? 'border border-sky-400/35 bg-sky-500/20 text-sky-100 shadow-[0_0_20px_rgba(14,165,233,0.18)]'
                  : 'border border-white/10 bg-white/[0.05] text-slate-400 hover:border-white/20 hover:bg-white/[0.08] hover:text-slate-200'
              }`}
            >
              🤖 TIMI AI
            </button>
          </div>

          <div className="grid w-full grid-cols-[3rem_1fr_3rem] items-end gap-2.5">
            <input
              type="file"
              ref={fileInputRef}
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
              id="image-upload"
            />
            <label
              htmlFor="image-upload"
              className="flex h-12 w-full cursor-pointer items-center justify-center rounded-xl border border-white/12 bg-white/[0.06] transition hover:border-violet-400/30 hover:bg-white/[0.1]"
              title="上传图片"
            >
              <ImageIcon size={20} className="text-slate-300" />
            </label>

            <textarea
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  send()
                }
              }}
              rows={1}
              className="box-border min-h-12 w-full max-h-[7.5rem] resize-none rounded-xl border border-white/12 bg-slate-950/50 px-3 py-2.5 text-sm leading-5 text-slate-100 placeholder:text-slate-500 focus:border-violet-400/45 focus:outline-none focus:ring-2 focus:ring-violet-500/15"
              placeholder={chatModel === 'timi' ? '问 TIMI AI…（支持上传图片）' : '问 Gemini…（支持上传图片）'}
            />

            <button
              type="button"
              onClick={send}
              disabled={loading}
              className="flex h-12 w-full items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-[0_8px_28px_rgba(99,102,241,0.4)] transition hover:from-indigo-400 hover:to-violet-500 disabled:cursor-not-allowed disabled:opacity-55 disabled:shadow-none"
            >
              <Send size={20} strokeWidth={2.25} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
