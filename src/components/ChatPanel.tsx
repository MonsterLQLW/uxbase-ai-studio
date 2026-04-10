import { useState, useRef } from 'react'
import { chatWithGemini, chatWithTIMI, type ChatMessage } from '../services/gemini'
import { Send, Image as ImageIcon, Loader } from 'lucide-react'

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
    reader.onload = (ev) => {
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
    <div className="flex h-full min-h-0 flex-col">
      {/* 消息列表 */}
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pb-4 pr-0.5">
        {messages.length === 0 && (
          <div className="flex min-h-[40vh] flex-col items-center justify-center px-4 text-center text-slate-500">
            <p className="mb-2 text-lg">👋 欢迎使用 UXbase AI Studio</p>
            <p className="text-sm">输入消息或上传图片开始对话</p>
          </div>
        )}
        {messages.map((m, i) => (
          <div
            key={i}
            className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-md px-4 py-3 rounded-2xl ${
                m.role === 'user'
                  ? 'bg-indigo-600 text-white rounded-br-md'
                  : 'bg-slate-800 text-slate-200 rounded-bl-md'
              }`}
            >
              {m.imageData && (
                <img
                  src={m.imageData}
                  alt="上传图片"
                  className="rounded-lg mb-2 max-w-full max-h-60 object-contain"
                />
              )}
              <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.text}</p>
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="bg-slate-800 px-4 py-3 rounded-2xl rounded-bl-md flex items-center gap-2 text-slate-400">
              <Loader size={16} className="animate-spin" />
              <span className="text-sm">思考中...</span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* 图片预览 */}
      {selectedImage && (
        <div className="flex flex-shrink-0 items-center gap-2 pb-3">
          <img src={selectedImage} alt="预览" className="h-16 rounded-lg object-cover" />
          <button
            onClick={() => setSelectedImage(null)}
            className="rounded-full bg-red-500/80 px-2 py-0.5 text-xs text-white hover:bg-red-500"
          >
            移除
          </button>
        </div>
      )}

      {/* 底部：模型 + 输入（与 Layout pb-10 留底边呼吸空间） */}
      <div className="flex flex-shrink-0 flex-col gap-3 border-t border-slate-800/90 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setChatModel('gemini')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              chatModel === 'gemini'
                ? 'bg-indigo-600 text-white'
                : 'border border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            ✨ Gemini
          </button>
          <button
            onClick={() => setChatModel('timi')}
            className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${
              chatModel === 'timi'
                ? 'bg-blue-600 text-white'
                : 'border border-slate-700 bg-slate-800 text-slate-400 hover:text-slate-200'
            }`}
          >
            🤖 TIMI AI
          </button>
        </div>

        {/* 底行：三列 grid + items-end，保证输入框与两侧按钮底边齐平 */}
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
            className="flex h-12 w-full cursor-pointer items-center justify-center rounded-xl border border-slate-700 bg-slate-800 transition hover:bg-slate-700"
            title="上传图片"
          >
            <ImageIcon size={20} className="text-slate-400" />
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
            className="min-h-12 w-full max-h-[7.5rem] resize-none rounded-xl border border-slate-700 bg-slate-800 px-3 py-2.5 text-sm leading-5 text-slate-200 placeholder:text-slate-500 box-border focus:border-indigo-500 focus:outline-none focus:ring-0"
            placeholder={chatModel === 'timi' ? '问 TIMI AI...（支持上传图片）' : '问 Gemini...（支持上传图片）'}
          />

          <button
            type="button"
            onClick={send}
            disabled={loading}
            className="flex h-12 w-full items-center justify-center rounded-xl bg-indigo-600 transition hover:bg-indigo-700 disabled:bg-indigo-800"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  )
}
