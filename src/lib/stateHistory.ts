/**
 * 状态历史记录管理
 * 用于头像框设计器的自动保存和版本管理
 */

export interface HistoryEntry {
  id: string
  timestamp: number
  name: string
  /** 轻量状态（不含大图 base64） */
  state: Record<string, unknown>
  /** 是否为自动保存 */
  auto: boolean
  /** 首页缩略图（仅当体积在阈值内时写入，旧数据可能为空） */
  thumbDataUrl?: string
}

const THUMB_MAX_CHARS = 120_000

/**
 * 从历史快照对应的完整状态中抽取一张可作为缩略图的 data URL（控制体积，避免撑爆 localStorage）
 */
export function extractHistoryThumbnail(state: Record<string, unknown>): string | undefined {
  const take = (s: unknown): string | undefined => {
    if (typeof s !== 'string' || !s.startsWith('data:image')) return undefined
    return s.length <= THUMB_MAX_CHARS ? s : undefined
  }

  const gen = state.generatedImageDataUrls
  if (Array.isArray(gen)) {
    for (const u of gen) {
      const t = take(u)
      if (t) return t
    }
  }

  for (const key of ['images', 'similarReferences'] as const) {
    const arr = state[key] as { dataUrl?: string }[] | undefined
    if (!Array.isArray(arr)) continue
    for (const it of arr) {
      const t = take(it?.dataUrl)
      if (t) return t
    }
  }

  const colorTheme = state.colorTheme as { images?: { dataUrl?: string }[] } | undefined
  const ci = colorTheme?.images
  if (Array.isArray(ci)) {
    for (const it of ci) {
      const t = take(it?.dataUrl)
      if (t) return t
    }
  }

  const rc = state.regionalConstraints as Record<string, { assets?: { dataUrl?: string }[] }> | undefined
  if (rc && typeof rc === 'object') {
    for (const k of Object.keys(rc)) {
      const assets = rc[k]?.assets
      if (!Array.isArray(assets)) continue
      for (const it of assets) {
        const t = take(it?.dataUrl)
        if (t) return t
      }
    }
  }

  return undefined
}

const STORAGE_KEY = 'avatarFrameHistory'

/** 从首页点击存档恢复时，用 sessionStorage 传递目标条目 id（避免整段 JSON 过大） */
export const PENDING_RESTORE_HISTORY_ID_KEY = 'pendingAvatarFrameHistoryRestoreId'
const MAX_HISTORY = 20
const AUTO_SAVE_INTERVAL_MS = 15_000 // 15秒（首页另有工作区快照，双轨保留进度）

/**
 * 从 state 中移除大图 base64，生成轻量版本
 */
export function stripHeavyState(state: Record<string, unknown>): Record<string, unknown> {
  const stripImages = (arr: unknown) =>
    Array.isArray(arr) ? arr.map((it: unknown) => ({ ...(it as object), dataUrl: '' })) : []

  const nextRegionalConstraints: Record<string, unknown> = {}
  const rc = state.regionalConstraints as Record<string, unknown> | undefined
  if (rc && typeof rc === 'object') {
    for (const k of Object.keys(rc)) {
      const v = rc[k] as Record<string, unknown> | undefined
      nextRegionalConstraints[k] = {
        ...(v || {}),
        assets: stripImages(v?.assets),
      }
    }
  }

  return {
    ...state,
    images: stripImages(state.images),
    similarReferences: stripImages(state.similarReferences),
    colorTheme: {
      ...(state.colorTheme as object),
      images: stripImages((state.colorTheme as Record<string, unknown> | undefined)?.images),
    },
    generatedImageDataUrls: [], // 生成结果不保存
    regionalConstraints: nextRegionalConstraints,
  }
}

/**
 * 加载历史记录
 */
export function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryEntry[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    console.warn('[stateHistory] 加载历史记录失败')
    return []
  }
}

/**
 * 保存历史记录
 */
export function saveHistory(history: HistoryEntry[]): void {
  try {
    // 只保留最近 MAX_HISTORY 条
    const trimmed = history.slice(-MAX_HISTORY)
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed))
  } catch (e) {
    console.warn('[stateHistory] 保存历史记录失败:', e)
  }
}

/**
 * 添加新的历史条目
 */
export function addHistoryEntry(
  state: Record<string, unknown>,
  name: string,
  auto: boolean = false,
  thumbDataUrl?: string
): HistoryEntry {
  const entry: HistoryEntry = {
    id: `hist_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: Date.now(),
    name,
    state: stripHeavyState(state),
    auto,
    ...(thumbDataUrl && thumbDataUrl.length <= THUMB_MAX_CHARS ? { thumbDataUrl } : {}),
  }
  return entry
}

/**
 * 格式化时间戳为可读字符串
 */
export function formatTimestamp(ts: number): string {
  const d = new Date(ts)
  const now = new Date()
  const isToday = d.toDateString() === now.toDateString()
  const timeStr = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
  if (isToday) {
    return `今天 ${timeStr}`
  }
  const dateStr = d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
  return `${dateStr} ${timeStr}`
}

/** 存档卡片左下角短日期 */
export function formatArchiveCornerDate(ts: number): string {
  return new Date(ts).toLocaleDateString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
}

/**
 * 删除指定历史条目
 */
export function deleteHistoryEntry(history: HistoryEntry[], id: string): HistoryEntry[] {
  return history.filter(e => e.id !== id)
}

/**
 * 清空所有历史记录
 */
export function clearHistory(): void {
  localStorage.removeItem(STORAGE_KEY)
}

/**
 * 获取自动保存间隔
 */
export function getAutoSaveInterval(): number {
  return AUTO_SAVE_INTERVAL_MS
}