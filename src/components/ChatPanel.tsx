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
    <div className="flex flex-col h-full p-6">
      {/* 消息列表 */}
      <div className="flex-1 overflow-y-auto space-y-4 mb-4">
        {messages.length === 0 && (
          <div className="text-center text-slate-500 mt-20">
            <p className="text-lg mb-2">👋 欢迎使用 UXbase AI Studio</p>
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
        <div className="mb-3 flex items-center gap-2">
          <img src={selectedImage} alt="预览" className="h-16 rounded-lg object-cover" />
          <button
            onClick={() => setSelectedImage(null)}
            className="text-xs bg-red-500/80 hover:bg-red-500 text-white rounded-full px-2 py-0.5"
          >
            移除
          </button>
        </div>
      )}

      {/* 模型选择器 + 输入区 */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setChatModel('gemini')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              chatModel === 'gemini'
                ? 'bg-indigo-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
            }`}
          >
            ✨ Gemini
          </button>
          <button
            onClick={() => setChatModel('timi')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              chatModel === 'timi'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700'
            }`}
          >
            🤖 TIMI AI
          </button>
        </div>
      {/* 输入区 */}
      <div className="flex gap-2 items-end">
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
          className="bg-slate-800 hover:bg-slate-700 border border-slate-700 
            p-3 rounded-xl cursor-pointer transition flex-shrink-0
            flex items-center justify-center"
          title="上传图片"
        >
          <ImageIcon size={20} className="text-slate-400" />
        </label>

        <div className="flex-1">
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
            className="w-full bg-slate-800 border border-slate-700 rounded-xl px-4 py-3 
              focus:outline-none focus:border-indigo-500 resize-none text-sm
              placeholder:text-slate-500"
            placeholder={chatModel === 'timi' ? '问 TIMI AI...（支持上传图片）' : '问 Gemini...（支持上传图片）'}
            style={{ minHeight: '48px', maxHeight: '120px' }}
          />
        </div>

        <button
          onClick={send}
          disabled={loading}
          className="bg-indigo-600 hover:bg-indigo-700 disabled:bg-indigo-800 
            p-3 rounded-xl transition flex-shrink-0 flex items-center justify-center"
        >
          <Send size={20} />
        </button>
      </div>
      </div>
    </div>
  )
}
