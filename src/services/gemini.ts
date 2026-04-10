import { GoogleGenAI } from '@google/genai'

import {
  defaultPixelFramePlan,
  ensureEveryImageUsed,
  normalizeAndValidatePlan,
  type PixelFramePlan,
} from '../lib/avatarFramePixelComposite'

// Gemini API 服务
// 通过设置页填写 API Key（localStorage: geminiApiKey），并注入到本模块
let API_KEY = ''
const MODEL = 'gemini-2.5-flash'
/** 多图理解用 Flash，通常比 Gemini 3 快很多 */
const MODEL_VISION_FAST = 'gemini-2.5-flash'
let ai: GoogleGenAI | null = null

const STORAGE_KEY_GEMINI = 'geminiApiKey'

try {
  if (typeof localStorage !== 'undefined') {
    const stored = localStorage.getItem(STORAGE_KEY_GEMINI)
    if (stored) API_KEY = stored.trim()
  }
} catch {
  /* ignore */
}

/** 兼容 @google/genai 不同版本的响应结构（避免误判“连接失败”） */
async function extractGeminiText(result: unknown): Promise<string> {
  if (result == null) return ''
  const r = result as Record<string, unknown> & {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  }
  const direct = r.text
  if (typeof direct === 'string' && direct.length > 0) return direct
  if (typeof direct === 'function') {
    try {
      const out = await (direct as () => unknown | Promise<unknown>)()
      if (typeof out === 'string' && out.length > 0) return out
    } catch {
      /* ignore */
    }
  }
  const parts = r.candidates?.[0]?.content?.parts
  if (Array.isArray(parts)) {
    const s = parts.map(p => (typeof p?.text === 'string' ? p.text : '')).join('')
    if (s) return s
  }
  return ''
}

export function setGeminiKey(key: string) {
  API_KEY = key.trim()
  ai = null
}

let TIMI_API_KEY = ''
let TIMI_API_URL = ''
let TIMI_MODEL = 'gpt-5'

export function setTIMIKey(key: string) {
  TIMI_API_KEY = key.trim()
}

export function setTIMIUrl(url: string) {
  TIMI_API_URL = url.trim()
}

export function setTIMIModel(model: string) {
  TIMI_MODEL = model.trim()
}

function getTIMIAuthHeaderValue() {
  const k = (TIMI_API_KEY || '').trim()
  if (!k) return ''
  // 兼容两种输入：
  // 1) 直接粘贴纯 key（自动补 Bearer）
  // 2) 粘贴完整 Authorization 值（如 "Bearer xxx"）
  const lower = k.toLowerCase()
  if (lower.startsWith('bearer ') || lower.startsWith('basic ') || lower.startsWith('apikey ') || lower.startsWith('api-key ')) {
    return k
  }
  if (k.includes(' ')) return k
  return `Bearer ${k}`
}

function getAI() {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: API_KEY })
  }
  return ai
}

/** 缩小参考图再送 Gemini，显著减少上传体积与延迟（浏览器内 Canvas） */
export async function compressDataUrlForGemini(dataUrl: string, maxEdge = 768, quality = 0.82): Promise<string> {
  if (typeof document === 'undefined') return dataUrl
  if (!dataUrl.startsWith('data:image')) return dataUrl
  const head = dataUrl.slice(0, 32).toLowerCase()
  if (head.includes('svg')) return dataUrl
  try {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve()
      img.onerror = () => reject(new Error('img'))
      img.src = dataUrl
    })
    const w = img.naturalWidth
    const h = img.naturalHeight
    if (!w || !h) return dataUrl
    const scale = Math.min(1, maxEdge / Math.max(w, h))
    const tw = Math.max(1, Math.round(w * scale))
    const th = Math.max(1, Math.round(h * scale))
    if (tw === w && th === h && head.includes('jpeg')) return dataUrl
    const canvas = document.createElement('canvas')
    canvas.width = tw
    canvas.height = th
    const ctx = canvas.getContext('2d')
    if (!ctx) return dataUrl
    ctx.drawImage(img, 0, 0, tw, th)
    return canvas.toDataURL('image/jpeg', quality)
  } catch {
    return dataUrl
  }
}

export interface ChatMessage {
  role: 'user' | 'model'
  text: string
  imageData?: string // base64 图片
}

export async function chatWithGemini(messages: ChatMessage[]) {
  const lastMsg = messages[messages.length - 1]

  // 构建 parts
  const parts: any[] = [{ text: lastMsg.text }]
  if (lastMsg.imageData) {
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: lastMsg.imageData.split(',')[1],
      },
    })
  }

  // 如果有历史消息，用 chats 接口
  if (messages.length > 1) {
    const chat = getAI().chats.create({
      model: MODEL,
      history: messages.slice(0, -1).map(m => ({
        role: m.role,
        parts: [{ text: m.text }],
      })),
    })
    const result = await chat.sendMessage({ message: parts })
    return (await extractGeminiText(result)) || ''
  }

  // 单条消息
  const result = await getAI().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
  })
  return (await extractGeminiText(result)) || ''
}

type GenerateOptions = {
  model?: string
  text: string
  imageDataUrls?: string[]
  /** 默认 true：多图请求前压缩以提速 */
  compressImages?: boolean
  /** 多图压缩最大边长（默认 768；布局推理可降到 560 提速） */
  compressMaxEdge?: number
  compressQuality?: number
}

export async function generateWithGemini({
  model,
  text,
  imageDataUrls,
  compressImages = true,
  compressMaxEdge = 768,
  compressQuality = 0.82,
}: GenerateOptions) {
  const raw = imageDataUrls || []
  const urls =
    compressImages && raw.length > 0
      ? await Promise.all(raw.map(u => compressDataUrlForGemini(u, compressMaxEdge, compressQuality)))
      : raw

  const parts: any[] = [{ text }]
  for (const url of urls) {
    const base64 = url.includes(',') ? url.split(',')[1] : url
    const mimeType = url.startsWith('data:image/png') ? 'image/png' : 'image/jpeg'
    parts.push({
      inlineData: {
        mimeType,
        data: base64,
      },
    })
  }

  const maxAttempts = 4
  const baseDelayMs = 700
  let lastErr: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const result = await getAI().models.generateContent({
        model: model || MODEL,
        contents: [{ role: 'user', parts }],
      })
      return (await extractGeminiText(result)) || ''
    } catch (e: unknown) {
      lastErr = e
      const norm = normalizeGenAIError(e)
      const lower = (norm.message || '').toLowerCase()
      const isUnavailable =
        norm.status === 503 || norm.code === 'UNAVAILABLE' || lower.includes('unavailable') || lower.includes('high demand')
      const isRateLimited =
        norm.status === 429 || lower.includes('quota') || lower.includes('resource exhausted') || lower.includes('rate')

      if ((isUnavailable || isRateLimited) && attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt)
        continue
      }

      if (isUnavailable) {
        throw new Error('模型当前拥堵（503 UNAVAILABLE）。请稍等 10–30 秒后重试，或减少输入图片数量/尺寸以提高成功率。')
      }
      if (isRateLimited) {
        throw new Error('请求过于频繁或配额受限（429）。请稍后再试，或检查 AI Studio 配额/限流。')
      }
      throw new Error(norm.message || '请求失败')
    }
  }

  const norm = normalizeGenAIError(lastErr)
  throw new Error(norm.message || '请求失败')
}

type GenerateImageOptions = {
  prompt: string
  model?: string
  numberOfImages?: number
  outputMimeType?: 'image/png' | 'image/jpeg'
  aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
}

function sleep(ms: number) {
  return new Promise<void>(resolve => setTimeout(resolve, ms))
}

function normalizeGenAIError(err: unknown): { status?: number; code?: string; message: string } {
  // 1) 对象型错误（很多 SDK 直接抛 object）
  if (err && typeof err === 'object') {
    const anyErr = err as any
    const e = anyErr?.error ?? anyErr
    const status =
      (typeof e?.code === 'number' ? e.code : undefined) ??
      (typeof anyErr?.statusCode === 'number' ? anyErr.statusCode : undefined) ??
      (typeof anyErr?.response?.status === 'number' ? anyErr.response.status : undefined)
    const code =
      (typeof e?.status === 'string' ? e.status : undefined) ??
      (typeof e?.code === 'string' ? e.code : undefined) ??
      (typeof anyErr?.name === 'string' ? anyErr.name : undefined)
    const message =
      (typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : undefined) ??
      (typeof anyErr?.message === 'string' && anyErr.message.trim() ? anyErr.message.trim() : undefined) ??
      ''
    if (message || status || code) {
      return { status, code, message: message || '未知错误' }
    }
  }

  // 2) Error / string
  const raw = err instanceof Error ? err.message : String(err)

  // 3) @google/genai 有时会把错误作为 JSON 字符串塞进 message
  try {
    const parsed = JSON.parse(raw) as any
    const e = parsed?.error ?? parsed
    const code = typeof e?.status === 'string' ? e.status : typeof e?.code === 'string' ? e.code : undefined
    const status = typeof e?.code === 'number' ? e.code : undefined
    const msg = typeof e?.message === 'string' && e.message.trim() ? e.message.trim() : raw
    return { status, code, message: msg }
  } catch {
    return { message: raw || '未知错误' }
  }
}

export async function generateImageWithImagen({
  prompt,
  model = 'imagen-4.0-generate-001',
  numberOfImages = 1,
  outputMimeType = 'image/png',
  aspectRatio = '1:1',
}: GenerateImageOptions) {
  const maxAttempts = 4
  const baseDelayMs = 900
  let lastErr: unknown = null

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const resp = await getAI().models.generateImages({
        model,
        prompt,
        config: {
          numberOfImages,
          outputMimeType,
          aspectRatio,
        },
      } as any)

      const generated = (resp as any)?.generatedImages
      if (!Array.isArray(generated) || generated.length === 0) return []

      return generated
        .map((gi: any) => gi?.image?.imageBytes)
        .filter(Boolean)
        .map((bytesBase64: string) => `data:${outputMimeType};base64,${bytesBase64}` as const)
    } catch (e: unknown) {
      lastErr = e
      const norm = normalizeGenAIError(e)
      const lower = (norm.message || '').toLowerCase()
      const isUnavailable =
        norm.status === 503 || norm.code === 'UNAVAILABLE' || lower.includes('unavailable') || lower.includes('high demand')
      const isRateLimited =
        norm.status === 429 || lower.includes('quota') || lower.includes('resource exhausted') || lower.includes('rate')

      // 仅对“临时性”错误做重试
      if ((isUnavailable || isRateLimited) && attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt)
        continue
      }

      if (isUnavailable) {
        throw new Error('图片模型当前拥堵（503 UNAVAILABLE）。请稍等 10–30 秒后重试，或把“一次出图”改为 1 张以提高成功率。')
      }
      if (isRateLimited) {
        throw new Error('请求过于频繁或配额受限（429）。请稍后再试，或检查 AI Studio 配额/限流。')
      }
      throw new Error(norm.message || '图片生成失败')
    }
  }

  const norm = normalizeGenAIError(lastErr)
  throw new Error(norm.message || '图片生成失败')
}

export type AvatarFramePixelImage = { id: string; label: string; dataUrl: string }

export type ExtractAvatarFramePixelLayoutOptions = {
  shape: 'circle' | 'square'
  quadrants: Array<'lt' | 'lb' | 'rt' | 'rb'>
  userPrompt: string
  /** 0–100：越高则布局更接近参考构图、多版本之间差异更小 */
  referenceSimilarity?: number
  images: AvatarFramePixelImage[]
  /** 看图布局推理用；默认 2.5 Flash */
  model?: string
}

export type GeminiConnectionResult = { ok: true; message: string } | { ok: false; message: string }

/**
 * 测试 Gemini 是否可用。可传入当前输入框里的 Key，避免 React 尚未同步到内存变量时误报失败。
 */
export async function testGeminiConnection(apiKeyFromInput?: string): Promise<GeminiConnectionResult> {
  const key = (apiKeyFromInput ?? API_KEY).trim()
  if (!key) {
    return {
      ok: false,
      message:
        '未填写 API Key。请到 Google AI Studio 创建 Key 后粘贴到设置页：https://aistudio.google.com/app/apikey',
    }
  }

  const client = new GoogleGenAI({ apiKey: key })
  try {
    const result = await client.models.generateContent({
      model: MODEL,
      contents: [
        {
          role: 'user',
          parts: [{ text: 'Reply with exactly one word: OK' }],
        },
      ],
    })
    const text = (await extractGeminiText(result)).trim()
    if (!text) {
      return {
        ok: false,
        message:
          '已收到响应但无法读取文本内容。请尝试刷新页面后重试，或将 @google/genai 升级到最新版本。',
      }
    }
    setGeminiKey(key)
    return { ok: true, message: '连接正常，API Key 可用。' }
  } catch (error: unknown) {
    console.error('Gemini connection test failed:', error)
    const raw = error instanceof Error ? error.message : String(error)
    const lower = raw.toLowerCase()
    if (
      lower.includes('failed to fetch') ||
      lower.includes('networkerror') ||
      lower.includes('network request failed') ||
      lower.includes('load failed') ||
      lower.includes('ecconnrefused')
    ) {
      return {
        ok: false,
        message:
          '网络无法访问 Google API（浏览器直连常被拦截）。请确认本机已可使用 Google 服务，或配置系统/浏览器代理后再试。',
      }
    }
    if (
      raw.includes('400') ||
      raw.includes('401') ||
      raw.includes('403') ||
      lower.includes('api key') ||
      lower.includes('permission') ||
      lower.includes('invalid')
    ) {
      return {
        ok: false,
        message: `API Key 无效或无权使用该模型：${raw}。请到 AI Studio 重新创建 Key 并粘贴。`,
      }
    }
    if (raw.includes('429') || lower.includes('quota') || lower.includes('resource exhausted')) {
      return {
        ok: false,
        message: `请求频率或配额受限：${raw}。请稍后再试或检查 AI Studio 配额。`,
      }
    }
    return { ok: false, message: raw || '未知错误' }
  }
}

export async function testTIMIConnection(): Promise<{ ok: boolean; message: string }> {
  if (!TIMI_API_KEY) {
    return { ok: false, message: '未填写 TIMI API Key' }
  }

  try {
    const auth = getTIMIAuthHeaderValue()
    if (!auth) return { ok: false, message: '未填写 TIMI API Key' }
    const response = await fetch('/timi-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
        'X-Target-Url': TIMI_API_URL,
      },
      body: JSON.stringify({
        model: TIMI_MODEL || 'gpt-5',
        messages: [{ role: 'user', content: 'Reply with exactly one word: OK' }],
        stream: false,
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      return { ok: false, message: `TIMI 连接失败 (${response.status}): ${text.slice(0, 200)}` }
    }

    const data = await response.json()
    const content = data?.choices?.[0]?.message?.content
    if (content) {
      return { ok: true, message: `TIMI 连接成功，模型 ${TIMI_MODEL || 'gpt-5'} 可用` }
    }

    return { ok: false, message: 'TIMI 返回了响应但格式异常' }
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    return { ok: false, message: `TIMI 连接失败: ${msg}` }
  }
}

/**
 * 通过 TIMI AI 代理发送聊天请求（OpenAI 兼容格式）
 */
export async function chatWithTIMI(messages: ChatMessage[]): Promise<string> {
  if (!TIMI_API_KEY) throw new Error('TIMI API Key 未配置，请到设置页填写')
  if (!TIMI_API_URL) throw new Error('TIMI API URL 未配置')
  const auth = getTIMIAuthHeaderValue()
  if (!auth) throw new Error('TIMI API Key 未配置，请到设置页填写')

  const formatted = messages.map(m => {
    const role = m.role === 'model' ? 'assistant' : m.role
    if (m.imageData) {
      return {
        role,
        content: [
          { type: 'text', text: m.text },
          { type: 'image_url', image_url: { url: m.imageData } },
        ],
      }
    }
    return { role, content: m.text }
  })

  const resp = await fetch('/timi-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
      'X-Target-Url': TIMI_API_URL,
    },
    body: JSON.stringify({
      model: TIMI_MODEL || 'gpt-5',
      messages: formatted,
      stream: false,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`TIMI API 错误 (${resp.status}): ${text.slice(0, 300)}`)
  }

  const data = await resp.json()
  const choice = data?.choices?.[0]
  const content = choice?.message?.content
  const finishReason = choice?.finish_reason
  const errMsg = data?.error?.message || data?.message
  if (typeof content !== 'string' || content.trim() === '') {
    if (errMsg) throw new Error(`TIMI 响应异常：${String(errMsg).slice(0, 300)}`)
    if (finishReason) throw new Error(`TIMI 未返回有效文本（finish_reason=${String(finishReason)}）`)
    throw new Error('TIMI 未返回有效文本（content 为空）')
  }
  return content
}

/**
 * 同类参考分析（TIMI chat）：一次消息携带多张 image_url
 */
export async function generateSimilarReferenceAnalysisWithTIMI(options: { prompt: string; imageDataUrls: string[] }): Promise<string> {
  const { prompt, imageDataUrls } = options
  if (!TIMI_API_KEY) throw new Error('TIMI API Key 未配置，请到设置页填写')
  if (!TIMI_API_URL) throw new Error('TIMI API URL 未配置')
  const auth = getTIMIAuthHeaderValue()
  if (!auth) throw new Error('TIMI API Key 未配置，请到设置页填写')

  const content: Array<Record<string, unknown>> = [{ type: 'text', text: prompt }]
  for (const url of imageDataUrls || []) {
    if (!url) continue
    content.push({ type: 'image_url', image_url: { url } })
  }

  const resp = await fetch('/timi-proxy', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: auth,
      'X-Target-Url': TIMI_API_URL,
    },
    body: JSON.stringify({
      model: TIMI_MODEL || 'gpt-5',
      messages: [{ role: 'user', content }],
      stream: false,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`TIMI 分析失败 (${resp.status}): ${text.slice(0, 300)}`)
  }

  const data = (await resp.json()) as any
  const choice = data?.choices?.[0]
  const out = choice?.message?.content
  const finishReason = choice?.finish_reason
  const errMsg = data?.error?.message || data?.message
  if (typeof out !== 'string' || out.trim() === '') {
    if (errMsg) throw new Error(`TIMI 分析响应异常：${String(errMsg).slice(0, 300)}`)
    if (finishReason) throw new Error(`TIMI 分析未返回有效文本（finish_reason=${String(finishReason)}）`)
    throw new Error('TIMI 分析未返回有效文本（content 为空）')
  }
  return out
}

// ─── TIMI 图像生成（文生图 + 图生图 / 参考生图） ─────────────────────────

export type TIMIImageModel =
  | 'gemini3pro-image'
  | 'gemini3pro-image-bft'
  | 'gemini3pro-image-stb'
  | 'nanobanana2-image'
  | 'nanobanana2-image-bft'
  | 'nanobanana2-image-stb'

/**
 * TIMI 图像模型 → 实际 model 字段名映射
 * 基于 TIMI 平台「二、图生图接口」文档
 */
export const TIMI_IMAGE_MODEL_MAP: Record<TIMIImageModel, { name: string; model: string; stable?: boolean }> = {
  'gemini3pro-image':       { name: 'Gemini 3 Pro Image',          model: 'gemini-3-pro-image-preview' },
  'gemini3pro-image-bft':   { name: 'Gemini 3 Pro Image (备选)',    model: 'gemini-3-pro-image-preview-bft' },
  'gemini3pro-image-stb':   { name: 'Gemini 3 Pro Image (稳定)',    model: 'gemini-3-pro-image-preview-stb', stable: true },
  'nanobanana2-image':      { name: 'NanoBanana 2 Image',           model: 'gemini-3.1-flash-image-preview' },
  'nanobanana2-image-bft':  { name: 'NanoBanana 2 Image (备选)',    model: 'gemini-3.1-flash-image-preview-bft' },
  'nanobanana2-image-stb':  { name: 'NanoBanana 2 Image (稳定)',    model: 'gemini-3.1-flash-image-preview-stb', stable: true },
}

export type TIMIImageAspectRatio = '1:1' | '4:3' | '16:9' | '21:9' | '9:16' | '4:5'
export type TIMIImageSize = '1K' | '2K' | '4K'

export type TIMIImageGenerateOptions = {
  /** TIMI 图像模型 key */
  timiModel: TIMIImageModel
  /** 文生图 / 图生图提示词 */
  prompt: string
  /** 参考生图：参考图的 base64 data URL 列表（支持多图） */
  referenceImages?: string[]
  /** 宽高比，默认 1:1 */
  aspectRatio?: TIMIImageAspectRatio
  /** 图片尺寸，默认 1K */
  imageSize?: TIMIImageSize
}

/**
 * 通过 TIMI 代理生成图片（/chat/completions 接口，图生图协议）
 *
 * 文档要点：
 * - 端点：/chat/completions（与 chat 相同）
 * - messages[].content 支持 text + image_url 混合
 * - response_modalities: ["IMAGE", "TEXT"]
 * - 响应：choices[0].message.images[0].image_url.url（base64 data URL）
 * - 稳定版模型用 generation_config.imageConfig 而非 image_config
 */
export async function generateImageWithTIMI({
  timiModel,
  prompt,
  referenceImages,
  aspectRatio = '1:1',
  imageSize = '1K',
}: TIMIImageGenerateOptions): Promise<string[]> {
  if (!TIMI_API_KEY) throw new Error('TIMI API Key 未配置，请到设置页填写')
  if (!TIMI_API_URL) throw new Error('TIMI API URL 未配置')
  const auth = getTIMIAuthHeaderValue()
  if (!auth) throw new Error('TIMI API Key 未配置，请到设置页填写')

  const modelInfo = TIMI_IMAGE_MODEL_MAP[timiModel]
  if (!modelInfo) throw new Error(`未知的 TIMI 图像模型: ${timiModel}`)

  const refMaxEdge = imageSize === '2K' ? 576 : 448
  const refQuality = imageSize === '2K' ? 0.82 : 0.72

  // 构建 messages：user content 支持多图 + 文本（显式声明出图档位，避免网关忽略 image_config）
  const userContent: Array<Record<string, unknown>> = [
    {
      type: 'text',
      text: [
        `IMAGE_OUTPUT_SIZE=${imageSize} (must honor; 1K=faster standard detail, 2K=sharper finer detail).`,
        '',
        prompt,
      ].join('\n'),
    },
  ]

  // 参考图在浏览器侧先压缩，显著减少 TIMI 请求体积与超时概率（1K 更激进以提速）
  const refs =
    referenceImages && referenceImages.length > 0
      ? await Promise.all(referenceImages.map(u => compressDataUrlForGemini(u, refMaxEdge, refQuality)))
      : []

  if (refs.length > 0) {
    for (const img of refs) {
      userContent.push({
        type: 'image_url',
        image_url: { url: img.startsWith('data:') ? img : `data:image/png;base64,${img}` },
      })
    }
  }

  // 请求体：标准版 vs 稳定版的 imageConfig 路径不同
  const body: Record<string, unknown> = {
    model: modelInfo.model,
    messages: [{ role: 'user', content: userContent }],
    response_modalities: ['IMAGE', 'TEXT'],
  }

  if (modelInfo.stable) {
    // 稳定版：generation_config.image_config（注意：不要同时传 snake_case + camelCase，否则会触发 oneof 冲突）
    body.generation_config = {
      image_config: {
        aspect_ratio: aspectRatio,
        image_size: imageSize,
        image_output_options: { mime_type: 'image/png' },
      },
    }
  } else {
    // 标准版：image_config（只传 snake_case，避免 image_size 与 imageSize 同时出现导致 oneof 冲突）
    body.image_config = {
      aspect_ratio: aspectRatio,
      image_size: imageSize,
    }
  }

  const maxAttempts = 3
  const baseDelayMs = 1200
  let lastText = ''
  let lastStatus = 0

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const resp = await fetch('/timi-proxy', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: auth,
        'X-Target-Url': TIMI_API_URL,
      },
      body: JSON.stringify(body),
    })

    if (!resp.ok) {
      lastStatus = resp.status
      lastText = await resp.text().catch(() => '')
      const lower = (lastText || '').toLowerCase()
      const isTimeout = resp.status === 504 || lower.includes('proxy timeout') || lower.includes('timeout')
      const isTransient = isTimeout || resp.status === 502 || resp.status === 503

      if (isTransient && attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt)
        continue
      }

      if (isTimeout) {
        throw new Error(
          `TIMI 图像生成超时（${resp.status}）。建议：把出图尺寸改为 1K、减少参考图数量、或换“稳定”模型再试。`,
        )
      }
      throw new Error(`TIMI 图像生成失败 (${resp.status}): ${lastText.slice(0, 300)}`)
    }

    const data = (await resp.json()) as any
    const choice = data?.choices?.[0]
    const message = choice?.message
    const finishReason = choice?.finish_reason
    const errMsg = data?.error?.message || data?.message
    if (!message) {
      // 某些网关会返回 200 但 body 不含 choices/message（偶发），视为可重试
      lastStatus = 200
      lastText = errMsg ? String(errMsg) : JSON.stringify(data || {}).slice(0, 300)
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt)
        continue
      }
      if (errMsg) throw new Error(`TIMI 响应异常：${String(errMsg).slice(0, 300)}`)
      if (finishReason) throw new Error(`TIMI 未返回图片（finish_reason=${String(finishReason)}）`)
      throw new Error('TIMI 返回的结构不完整（缺少 choices[0].message）')
    }

    // 从 choices[0].message.images 提取图片
    const images: string[] = []
    if (Array.isArray(message.images)) {
      for (const img of message.images) {
        const url = img?.image_url?.url
        if (url) {
          images.push(url.startsWith('data:') ? url : `data:image/png;base64,${url}`)
        }
      }
    }

    if (images.length === 0) {
      // message 存在但 images 为空也可能是偶发/网关降级，优先重试
      lastStatus = 200
      lastText = errMsg ? String(errMsg) : JSON.stringify(message || {}).slice(0, 300)
      if (attempt < maxAttempts) {
        await sleep(baseDelayMs * attempt)
        continue
      }
      if (errMsg) throw new Error(`TIMI 未返回图片：${String(errMsg).slice(0, 300)}`)
      if (finishReason) throw new Error(`TIMI 未返回图片（finish_reason=${String(finishReason)}）`)
      throw new Error('TIMI 返回了空的图片结果')
    }

    return images
  }

  throw new Error(`TIMI 图像生成失败 (${lastStatus || 0}): ${(lastText || '').slice(0, 300)}`)
}

/**
 * 判断 aiModel 字符串是否属于 TIMI 图像模型
 */
export function isTIMIImageModel(model: string): model is TIMIImageModel {
  return model in TIMI_IMAGE_MODEL_MAP
}

/** 圆形/方形 = 构图趋势，不要画成明显的几何描边洞轮廓（给 TIMI / Imagen / 布局 JSON 共用） */
export function avatarFrameShapeIntentPromptEn(shape: 'circle' | 'square'): string {
  const trend =
    shape === 'circle'
      ? 'radial / softly rounded overall rhythm—decorations cluster around an implied round portrait area'
      : 'gentle card-like / squarish massing—corners feel slightly boxed but still organic, not a sharp square wireframe'
  return [
    `Shape intent (composition trend ONLY, NOT a visible outline): ${trend}.`,
    'Do NOT draw: a crisp geometric ring, inner circle/square stroke, bezel line, UI template border, metal rim tracing the hole, or any single continuous contour line that outlines the avatar cutout.',
    'The portrait opening must read as negative space formed by motif density, overlap, feathering, and organic gaps—never a hard vector-like traced circle or rectangle.',
  ].join('\n')
}

function layoutSimilarityNote(sim: number) {
  const s = Math.min(100, Math.max(0, Math.round(sim)))
  if (s >= 85) {
    return `LAYOUT_MODE=HIGH_MATCH (${s}). Prefer positions/scales/rotations that KEEP each uploaded asset immediately recognizable: use larger scale (0.65–1.15), small rotations (|rotateDeg| <= 12), place motifs near where they appear in references (top/bottom/left/right balance).`
  }
  if (s >= 55) {
    return `LAYOUT_MODE=BALANCED (${s}). Stay faithful to what's visible in the reference crops but you may rearrange around the ring for clarity.`
  }
  return `LAYOUT_MODE=CREATIVE (${s}). You may use stronger rotation and smaller scales, but still ONLY use the provided imageIds (no invented graphics).`
}

/**
 * 从参考图中推断像素合成用的布局（仅 JSON）。实际画面由本地 Canvas drawImage 完成，保证可见像素来自用户上传图。
 */
export async function extractAvatarFramePixelLayout({
  shape,
  quadrants,
  userPrompt,
  referenceSimilarity = 70,
  images,
}: ExtractAvatarFramePixelLayoutOptions): Promise<{ plan: PixelFramePlan; analysisText: string }> {
  if (images.length === 0) {
    throw new Error('至少需要一张参考图')
  }

  const allowed = new Set(images.map(i => i.id))
  const idLines = images
    .map(i => `- imageId: ${JSON.stringify(i.id)}  label: ${JSON.stringify(i.label || '')}`)
    .join('\n')

  const quadrantText =
    quadrants.length === 0
      ? 'no quadrant preference (distribute around ring)'
      : quadrants
          .map(q => (q === 'lt' ? 'top-left' : q === 'lb' ? 'bottom-left' : q === 'rt' ? 'top-right' : 'bottom-right'))
          .join(', ')

  const simNote = layoutSimilarityNote(referenceSimilarity)

  const text = [
    'You are a STRICT layout-only planner for an avatar FRAME (decorative ring around a center hole).',
    'The user attached REAL reference images. The final rendered frame will ONLY draw pixels from those exact files via imageId.',
    'You must NOT invent textures, clipart, characters, or motifs that are not present in the attachments.',
    'Your job: decide where each imageId is placed on a 1:1 canvas (0,0 top-left; 1,1 bottom-right), scale, rotation, opacity, z-order, and optional borderWidth (almost always 0—no visible geometric rim).',
    '',
    simNote,
    '',
    'Allowed imageId values (use EXACT strings):',
    idLines,
    '',
    'Hard rules:',
    '- Return ONLY one JSON object, no markdown fences, no commentary.',
    '- Keys: placements (array), borderWidth (number 0–24, **prefer 0**: no stroked hole outline; avoid “template ring” look), borderColor (CSS hex, only if borderWidth>0).',
    '- placements[] entries: imageId (string, MUST be one of the allowed ids), x, y in [0,1] for CENTER of that asset, scale (~0.2–1.25), rotateDeg (-180..180), opacity (0.35–1), zIndex (integer).',
    '- Every allowed imageId must appear in placements at least once.',
    '- You may reuse the same imageId multiple times if it helps symmetry.',
    `- Shape trend for planning (NOT a drawn edge): ${shape === 'circle' ? 'soft radial balance around center' : 'soft squarish/card-like balance around center'}—motifs imply the hole; never plan for a stroked contour.`,
    `- Put MORE decorative weight toward these quadrants: ${quadrantText}.`,
    '',
    'Example shape (values are illustrative; you must use real ids from the list):',
    '{"placements":[{"imageId":"<REAL_ID>","x":0.72,"y":0.30,"scale":0.88,"rotateDeg":-6,"opacity":1,"zIndex":0}],"borderWidth":0,"borderColor":"#6366f1"}',
    '',
    'User intent for LAYOUT (not new art):',
    userPrompt?.trim() || 'Arrange references evenly around the ring, cohesive silhouette.',
  ].join('\n')

  // 布局推理不需要大模型：固定 Flash + 更小参考图，显著提速
  const analysis = await generateWithGemini({
    model: MODEL_VISION_FAST,
    text,
    imageDataUrls: images.map(i => i.dataUrl),
    compressMaxEdge: 560,
    compressQuality: 0.78,
  })

  const start = analysis.indexOf('{')
  const end = analysis.lastIndexOf('}')
  let plan: PixelFramePlan
  if (start >= 0 && end > start) {
    try {
      const parsed: unknown = JSON.parse(analysis.slice(start, end + 1))
      const valid = normalizeAndValidatePlan(parsed, allowed)
      plan = valid ? ensureEveryImageUsed(valid, images) : defaultPixelFramePlan(images, quadrants)
    } catch {
      plan = defaultPixelFramePlan(images, quadrants)
    }
  } else {
    plan = defaultPixelFramePlan(images, quadrants)
  }

  return { plan, analysisText: analysis }
}

function redrawSimilarityGuidanceEn(sim: number) {
  const s = Math.min(100, Math.max(0, Math.round(sim)))
  if (s >= 85) {
    return [
      `REFERENCE_FIDELITY=${s}/100 (VERY HIGH).`,
      'Redraw in ONE cohesive art style. Preserve the signature shapes, materials, ornament language, and color relationships seen in the references.',
      'Do NOT collage, photobash, or paste the reference images; instead, reinterpret them faithfully as a unified frame illustration.',
      'Keep novelty low: only adjust for fitting around the avatar hole.',
    ].join(' ')
  }
  if (s >= 55) {
    return [
      `REFERENCE_FIDELITY=${s}/100 (BALANCED).`,
      'Keep palette + key motifs faithful, but you may simplify and redesign details for cohesion.',
    ].join(' ')
  }
  if (s >= 25) {
    return [
      `REFERENCE_FIDELITY=${s}/100 (MODERATE).`,
      'Use references as strong inspiration; keep theme and a few signature motifs but allow noticeable redesign.',
    ].join(' ')
  }
  return [
    `REFERENCE_FIDELITY=${s}/100 (LOW).`,
    'Use references as loose inspiration; prioritize a fresh, cohesive frame design.',
  ].join(' ')
}

export type AvatarFrameRedrawFromRefsOptions = {
  shape: 'circle' | 'square'
  quadrants: Array<'lt' | 'lb' | 'rt' | 'rb'>
  userPrompt: string
  referenceSimilarity?: number
  images: Array<{ label: string; dataUrl: string }>
  /** Imagen 出图张数 1–3，默认 1（快很多） */
  imageOutputCount?: number
  /** 与展示面板「出图尺寸」一致；Imagen 无精确像素 API，写入提示词引导细节量 */
  outputImageSize?: '1K' | '2K'
}

/**
 * AI 重绘路径：Gemini 从参考图提炼「风格与母题」→ Imagen 按该风格重绘成一个统一头像框。
 * 注意：Imagen 在此路径是纯文本出图（不直接喂图），一致性依赖提示词与提炼质量。
 */
export async function generateAvatarFrameRedrawFromRefs({
  shape,
  quadrants,
  userPrompt,
  referenceSimilarity = 70,
  images,
  imageOutputCount = 1,
  outputImageSize = '1K',
}: AvatarFrameRedrawFromRefsOptions) {
  const nOut = Math.min(3, Math.max(1, Math.round(imageOutputCount)))
  const simGuide = redrawSimilarityGuidanceEn(referenceSimilarity)
  const quadrantText =
    quadrants.length === 0
      ? 'no preference'
      : quadrants
          .map(q => (q === 'lt' ? 'top-left' : q === 'lb' ? 'bottom-left' : q === 'rt' ? 'top-right' : 'bottom-right'))
          .join(', ')

  const instruction = [
    'Avatar frame style extractor. ' + simGuide,
    'Carefully extract a cohesive art direction from the reference images (palette, line/edge style, materials, ornament vocabulary, lighting, rendering technique).',
    'Then propose a unified frame design description that can be redrawn consistently (NOT a collage).',
    'Return ONLY JSON (no markdown):',
    '{"palette":["#hex"],"signatureMotifs":[],"ornamentLanguage":"","materials":[],"lineStyle":"","renderingStyle":"","lighting":"","compositionNotes":"","doNot":[]}',
  ].join(' ')

  const refList = images.map((img, idx) => `${idx + 1}. ${img.label || `ref${idx + 1}`}`).join('\n')
  const text = [
    instruction,
    '',
    'User intent:',
    userPrompt?.trim() || '(none)',
    '',
    avatarFrameShapeIntentPromptEn(shape),
    `Preferred decoration quadrants: ${quadrantText}`,
    `Reference similarity slider (0-100, higher = closer to refs): ${referenceSimilarity}`,
    '',
    'Reference labels:',
    refList || '(none)',
  ].join('\n')

  const analysis = await generateWithGemini({
    model: MODEL_VISION_FAST,
    text,
    imageDataUrls: images.map(i => i.dataUrl),
    compressMaxEdge: outputImageSize === '2K' ? 720 : 640,
    compressQuality: 0.8,
  })

  const start = analysis.indexOf('{')
  const end = analysis.lastIndexOf('}')
  if (!(start >= 0 && end > start)) {
    throw new Error('AI 提取失败：未返回可解析的 JSON')
  }
  const recipe = JSON.parse(analysis.slice(start, end + 1)) as any

  const palette = Array.isArray(recipe?.palette) ? recipe.palette.slice(0, 8).join(', ') : ''
  const motifs = Array.isArray(recipe?.signatureMotifs) ? recipe.signatureMotifs.slice(0, 12).join(', ') : ''
  const materials = Array.isArray(recipe?.materials) ? recipe.materials.slice(0, 8).join(', ') : ''
  const doNot = Array.isArray(recipe?.doNot) ? recipe.doNot.join(', ') : ''
  const ornamentLanguage = typeof recipe?.ornamentLanguage === 'string' ? recipe.ornamentLanguage : ''
  const lineStyle = typeof recipe?.lineStyle === 'string' ? recipe.lineStyle : ''
  const renderingStyle = typeof recipe?.renderingStyle === 'string' ? recipe.renderingStyle : ''
  const lighting = typeof recipe?.lighting === 'string' ? recipe.lighting : ''
  const compositionNotes = typeof recipe?.compositionNotes === 'string' ? recipe.compositionNotes : ''

  const detailTier =
    outputImageSize === '2K'
      ? 'Detail tier: HIGH (~2K intent) — preserve fine ornament edges, micro-textures, and crisp anti-aliased contours.'
      : 'Detail tier: STANDARD (~1K intent) — clean readable shapes; avoid ultra-fine noise that slows rendering.'

  const imagenPrompt = [
    'Create a high-quality 1:1 PNG avatar frame with a fully transparent background (no solid background).',
    detailTier,
    'The output must be ONE cohesive, unified design in a single consistent art style.',
    'No text, no watermark, no logo.',
    'Do NOT collage, photobash, paste photos, or show rectangular cutout edges. Avoid any “sticker sheet” look.',
    'Avoid obvious stock asset vibes; everything must share consistent line weight, shading model, and material rendering.',
    avatarFrameShapeIntentPromptEn(shape),
    `Decoration emphasis quadrants: ${quadrantText}.`,
    simGuide,
    '',
    'Style bible (derived from references):',
    palette ? `Color palette: ${palette}.` : '',
    materials ? `Materials: ${materials}.` : '',
    motifs ? `Signature motifs to include (redrawn): ${motifs}.` : '',
    ornamentLanguage ? `Ornament language: ${ornamentLanguage}.` : '',
    lineStyle ? `Line/edge style: ${lineStyle}.` : '',
    renderingStyle ? `Rendering style: ${renderingStyle}.` : '',
    lighting ? `Lighting: ${lighting}.` : '',
    compositionNotes ? `Composition notes: ${compositionNotes}.` : '',
    doNot ? `Avoid: ${doNot}.` : '',
    '',
    'Extra negatives: text, watermark, logo, QR code, signature, UI, frame mockup, border around the whole image, circular or square stroked outline tracing the inner portrait hole, geometric ring/bezel contour, obvious template frame edge.',
  ]
    .filter(Boolean)
    .join('\n')

  const imgs = await generateImageWithImagen({
    prompt: imagenPrompt,
    outputMimeType: 'image/png',
    aspectRatio: '1:1',
    numberOfImages: nOut,
  })

  return { imageDataUrls: imgs, recipe, analysisText: analysis }
}
