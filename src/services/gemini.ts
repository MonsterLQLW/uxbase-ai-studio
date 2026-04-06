import { GoogleGenAI } from '@google/genai'

// Gemini API 服务
// 通过 SettingsPanel 设置 API Key，并动态注入到 client
let API_KEY = ''
const MODEL = 'gemini-2.5-flash'
let ai: GoogleGenAI | null = null

export function setGeminiKey(key: string) {
  API_KEY = key.trim()
  ai = null
}

let TIMI_API_KEY = ''
let TIMI_API_URL = 'https://api.timi.ai/generate'

export function setTIMIKey(key: string) {
  TIMI_API_KEY = key.trim()
}

export function setTIMIUrl(url: string) {
  TIMI_API_URL = url.trim()
}

function getAI() {
  if (!ai) {
    ai = new GoogleGenAI({ apiKey: API_KEY })
  }
  return ai
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
    const resp = result as any
    return resp.text || ''
  }

  // 单条消息
  const result = await getAI().models.generateContent({
    model: MODEL,
    contents: [{ role: 'user', parts }],
  })
  const resp = result as any
  return resp.text || ''
}

type GenerateOptions = {
  model?: string
  text: string
  imageDataUrls?: string[]
}

export async function generateWithGemini({ model, text, imageDataUrls }: GenerateOptions) {
  const parts: any[] = [{ text }]
  for (const url of imageDataUrls || []) {
    const base64 = url.includes(',') ? url.split(',')[1] : url
    parts.push({
      inlineData: {
        mimeType: 'image/png',
        data: base64,
      },
    })
  }

  const result = await getAI().models.generateContent({
    model: model || MODEL,
    contents: [{ role: 'user', parts }],
  })
  const resp = result as any
  return resp.text || ''
}

type GenerateImageOptions = {
  prompt: string
  model?: string
  numberOfImages?: number
  outputMimeType?: 'image/png' | 'image/jpeg'
  aspectRatio?: '1:1' | '3:4' | '4:3' | '9:16' | '16:9'
}

export async function generateImageWithImagen({
  prompt,
  model = 'imagen-4.0-generate-001',
  numberOfImages = 1,
  outputMimeType = 'image/png',
  aspectRatio = '1:1',
}: GenerateImageOptions) {
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
}

type AvatarFrameFromRefsOptions = {
  shape: 'circle' | 'square'
  quadrants: Array<'lt' | 'lb' | 'rt' | 'rb'>
  userPrompt: string
  images: Array<{ label: string; dataUrl: string }>
  model?: string
}

export async function testGeminiConnection(): Promise<boolean> {
  if (!API_KEY) {
    return false
  }

  try {
    const prompt = '请用一句话确认 API 连接是否正常。'
    const result = await getAI().models.generateContent({
      model: MODEL,
      contents: [{
        role: 'user',
        parts: [{ text: prompt }],
      }],
    })
    const resp = result as any
    return Boolean(resp?.text)
  } catch (error) {
    console.error('Gemini connection test failed:', error)
    return false
  }
}

export async function testTIMIConnection(): Promise<boolean> {
  if (!TIMI_API_KEY) {
    return false
  }

  try {
    const response = await fetch(TIMI_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${TIMI_API_KEY}`,
      },
      body: JSON.stringify({
        prompt: 'test connection',
        size: '256x256',
      }),
    })

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      console.warn('TIMI connection test failed:', response.status, text)
      return false
    }

    const contentType = response.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const data = await response.json()
      return Boolean(data && (data.image || data.image_url || data.data || data.result))
    }

    return true
  } catch (error) {
    console.error('TIMI connection test failed:', error)
    return false
  }
}

export async function generateAvatarFrameFromRefs({
  shape,
  quadrants,
  userPrompt,
  images,
  model = 'gemini-3-flash-preview',
}: AvatarFrameFromRefsOptions) {
  const quadrantText =
    quadrants.length === 0
      ? 'no preference'
      : quadrants
          .map(q => (q === 'lt' ? 'top-left' : q === 'lb' ? 'bottom-left' : q === 'rt' ? 'top-right' : 'bottom-right'))
          .join(', ')

  const instruction = [
    'You are an avatar frame designer.',
    'You MUST heavily base the design on the provided reference images by extracting their motifs, materials, shapes, patterns, and color palette.',
    'Do NOT create an unrelated new style. The output must feel like a redesign derived from the references.',
    'Return ONLY JSON (no markdown) with fields:',
    '{',
    '  "palette": ["#RRGGBB", "..."],',
    '  "motifs": ["..."],',
    '  "materials": ["..."],',
    '  "composition": "one sentence describing how elements wrap around the frame",',
    '  "effects": ["glow", "sparkles", "..."],',
    '  "negative": ["text", "watermark", "..."]',
    '}',
  ].join('\n')

  const refList = images.map((img, idx) => `${idx + 1}. ${img.label || `ref${idx + 1}`}`).join('\n')
  const text = [
    instruction,
    '',
    'User intent:',
    userPrompt?.trim() || '(none)',
    '',
    `Frame shape: ${shape === 'circle' ? 'circle' : 'rounded square'}`,
    `Preferred decoration quadrants: ${quadrantText}`,
    '',
    'Reference labels:',
    refList || '(none)',
  ].join('\n')

  const analysis = await generateWithGemini({
    model,
    text,
    imageDataUrls: images.map(i => i.dataUrl),
  })

  const start = analysis.indexOf('{')
  const end = analysis.lastIndexOf('}')
  if (!(start >= 0 && end > start)) {
    throw new Error('AI 提取失败：未返回可解析的 JSON')
  }
  const recipe = JSON.parse(analysis.slice(start, end + 1)) as any

  const palette = Array.isArray(recipe?.palette) ? recipe.palette.slice(0, 6).join(', ') : ''
  const motifs = Array.isArray(recipe?.motifs) ? recipe.motifs.slice(0, 10).join(', ') : ''
  const materials = Array.isArray(recipe?.materials) ? recipe.materials.slice(0, 6).join(', ') : ''
  const effects = Array.isArray(recipe?.effects) ? recipe.effects.slice(0, 6).join(', ') : ''
  const negative = Array.isArray(recipe?.negative) ? recipe.negative.join(', ') : 'text, watermark, logo'
  const composition = typeof recipe?.composition === 'string' ? recipe.composition : ''

  const imagenPrompt = [
    'Create a high-quality 1:1 PNG avatar frame with TRANSPARENT-looking background (no solid background).',
    'No text, no watermark, no logo.',
    `Frame shape: ${shape === 'circle' ? 'circle hole' : 'rounded-square hole'} for the avatar in the center.`,
    `Decoration emphasis quadrants: ${quadrantText}.`,
    'The design must be a cohesive full frame (not a collage).',
    'Derive the style from the reference recipe:',
    palette ? `Color palette: ${palette}.` : '',
    materials ? `Materials: ${materials}.` : '',
    motifs ? `Motifs: ${motifs}.` : '',
    composition ? `Composition: ${composition}.` : '',
    effects ? `Effects: ${effects}.` : '',
    `Negative: ${negative}.`,
  ]
    .filter(Boolean)
    .join('\n')

  const imgs = await generateImageWithImagen({
    prompt: imagenPrompt,
    outputMimeType: 'image/png',
    aspectRatio: '1:1',
    numberOfImages: 3,
  })

  return { imageDataUrls: imgs, recipe, analysisText: analysis }
}
