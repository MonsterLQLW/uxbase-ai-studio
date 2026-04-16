/**
 * 各 Tab 工作区快照：供首页「项目存档」展示与一键跳转恢复。
 * 与 avatarFrameHistory（版本历史）互补：快照反映「当前各工具进度」，更新更频繁。
 */

import { loadHistory, type HistoryEntry } from './stateHistory'

export type WorkspacePinSource = 'avatar-frame' | 'chat' | 'ai-matting' | 'output-tool'

export const PENDING_WORKSPACE_NAV_KEY = 'uxPendingWorkspaceNavSource'

const SNAP_PREFIX = 'uxWorkspaceSnap_'

const MAX_SNAP_JSON = 950_000

export interface WorkspaceSnapshot {
  source: WorkspacePinSource
  updatedAt: number
  title: string
  subtitle: string
  thumbDataUrl?: string
  /** 恢复用；头像框快照可为 null（仅快捷进入，状态已由 avatarFrameState 持久化） */
  payload: unknown | null
  /** 头像框等工作区在无 payload 时标记是否有内容 */
  hasWork?: boolean
}

export type HomeGridItem =
  | { kind: 'workspace'; snap: WorkspaceSnapshot; cardKey: string }
  | { kind: 'avatar-history'; entry: HistoryEntry; cardKey: string }

function snapKey(source: WorkspacePinSource) {
  return `${SNAP_PREFIX}${source}`
}

export function saveWorkspaceSnapshot(s: WorkspaceSnapshot): void {
  try {
    let json = JSON.stringify(s)
    if (json.length > MAX_SNAP_JSON) {
      if (s.source === 'chat' && s.payload && typeof s.payload === 'object') {
        const next = { ...s, payload: lightenChatPayload(s.payload as ChatSnapPayload) }
        json = JSON.stringify(next)
      }
      if (json.length > MAX_SNAP_JSON) {
        console.warn('[workspaceSnap] 体积过大，跳过写入:', s.source)
        return
      }
    }
    localStorage.setItem(snapKey(s.source), json)
  } catch (e) {
    console.warn('[workspaceSnap] 保存失败:', s.source, e)
  }
  window.dispatchEvent(new CustomEvent('ux-workspace-snap-updated'))
}

export function loadWorkspaceSnapshot(source: WorkspacePinSource): WorkspaceSnapshot | null {
  try {
    const raw = localStorage.getItem(snapKey(source))
    if (!raw) return null
    return JSON.parse(raw) as WorkspaceSnapshot
  } catch {
    return null
  }
}

export function clearWorkspaceSnapshot(source: WorkspacePinSource): void {
  try {
    localStorage.removeItem(snapKey(source))
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent('ux-workspace-snap-updated'))
}

/** 设置从首页跳转的目标 Tab（由目标页消费后清除） */
export function setPendingWorkspaceNav(source: WorkspacePinSource) {
  try {
    sessionStorage.setItem(PENDING_WORKSPACE_NAV_KEY, source)
  } catch {
    /* ignore */
  }
}

/** 仅当待跳转目标与当前 Tab 一致时消费，避免误吞其它工具的 pending */
export function tryConsumePendingWorkspaceNav(target: WorkspacePinSource): boolean {
  try {
    const v = sessionStorage.getItem(PENDING_WORKSPACE_NAV_KEY)
    if (v !== target) return false
    sessionStorage.removeItem(PENDING_WORKSPACE_NAV_KEY)
    return true
  } catch {
    return false
  }
}

export interface ChatSnapPayload {
  messages: Array<{ role: 'user' | 'model'; text: string; imageData?: string }>
  chatModel: 'gemini' | 'timi'
}

/** 与 OutputTool 默认戳戳文案一致，用于判定「是否有可存档进度」 */
export const OUTPUT_TOOL_DEFAULT_POKE = {
  bg: '#1a1a2e',
  text1: '',
  text2: '',
  draft: '1080×1080\n750×1334\n512×512',
  outW: 400,
  outH: 400,
} as const

export interface OutputToolSnapPayload {
  activeTab: string
  templateChannel: 'custom' | 'wz-domestic' | 'wz-camp'
  wzDomesticSection: 'assets' | 'mall'
  character: { dataUrl: string; name: string } | null
  logo: { dataUrl: string; name: string } | null
  layer7: { dataUrl: string; name: string }
  layer7TintBlue: string
  layer7TintPurple: string
  logoW: number
  logoH: number
  logoMargin: number
  glowEnabled: boolean
  glowColor: string
  glowSize: number
  glowOpacity: number
  charScale: number
  charOffsetX: number
  charOffsetY: number
  blueFileName: string
  purpleFileName: string
  /** 戳戳预览/导出画布（可选） */
  pokeOutputW?: number
  pokeOutputH?: number
  pokeBgColor?: string
  pokeText1?: string
  pokeText2?: string
  pokeFontSize?: number
  pokeFontColor?: string
  pokeMultiSizeDraft?: string
  pokeMaskColor?: string
  pokeMaskOpacity?: number
  pokeMaskLayer?: { dataUrl: string; name: string }
  pokeMaskReach?: number
  pokeMaskFalloff?: number
  /** 遮罩滑块量程加倍后读档：为 true 时不再做 reach/opacity×2 迁移 */
  pokeMaskSliderRangeV2?: boolean
  /** 戳戳工作流节点（含多实例元素模板） */
  pokeNodes?: unknown
  pokeEdges?: unknown
  /** 旧版单元素层，读档时迁移为 otPokeElement 节点 */
  pokeElementLayer?: { dataUrl: string; name: string } | null
}

export function isOutputToolSnapPayloadMeaningful(p: unknown): boolean {
  if (!p || typeof p !== 'object') return false
  const o = p as OutputToolSnapPayload
  if (o.character?.dataUrl) return true
  if (o.logo?.dataUrl) return true
  if (o.pokeElementLayer?.dataUrl) return true
  const nodes = o.pokeNodes
  if (Array.isArray(nodes)) {
    for (const n of nodes) {
      const node = n as {
        type?: string
        data?: { elementTemplate?: { layer?: { dataUrl?: string } } }
      }
      if (node.type === 'otPokeElement' && node.data?.elementTemplate?.layer?.dataUrl) return true
    }
  }
  if (typeof o.pokeBgColor === 'string' && o.pokeBgColor && o.pokeBgColor !== OUTPUT_TOOL_DEFAULT_POKE.bg) return true
  if (typeof o.pokeText1 === 'string' && o.pokeText1 !== OUTPUT_TOOL_DEFAULT_POKE.text1) return true
  if (typeof o.pokeText2 === 'string' && o.pokeText2 !== OUTPUT_TOOL_DEFAULT_POKE.text2) return true
  if (
    typeof o.pokeMultiSizeDraft === 'string' &&
    o.pokeMultiSizeDraft.trim() !== OUTPUT_TOOL_DEFAULT_POKE.draft
  )
    return true
  if (typeof o.pokeOutputW === 'number' && o.pokeOutputW !== OUTPUT_TOOL_DEFAULT_POKE.outW) return true
  if (typeof o.pokeOutputH === 'number' && o.pokeOutputH !== OUTPUT_TOOL_DEFAULT_POKE.outH) return true
  return false
}

function lightenChatPayload(p: ChatSnapPayload): ChatSnapPayload {
  const messages = (p.messages || []).map((m) => ({
    role: m.role,
    text: m.text,
    ...(m.imageData && m.imageData.length < 180_000 ? { imageData: m.imageData } : {}),
  }))
  return { messages, chatModel: p.chatModel }
}

export function isAvatarStateNonEmpty(state: Record<string, unknown>): boolean {
  if (String(state.aiPrompt || '').trim()) return true
  if (Array.isArray(state.generatedImageDataUrls) && state.generatedImageDataUrls.length > 0) return true
  if (Array.isArray(state.images) && state.images.length > 0) return true
  if (Array.isArray(state.similarReferences) && state.similarReferences.length > 0) return true
  const comp = state.composite as { elements?: unknown[] } | undefined
  if (comp?.elements && Array.isArray(comp.elements) && comp.elements.length > 0) return true
  return false
}

function isSnapshotMeaningful(snap: WorkspaceSnapshot): boolean {
  switch (snap.source) {
    case 'avatar-frame':
      return snap.hasWork === true
    case 'chat': {
      const p = snap.payload as ChatSnapPayload | null
      return !!(p && Array.isArray(p.messages) && p.messages.length > 0)
    }
    case 'ai-matting': {
      const p = snap.payload as { originalDataUrl?: string; processedDataUrl?: string } | null
      return !!(p?.originalDataUrl || p?.processedDataUrl)
    }
    case 'output-tool':
      return isOutputToolSnapPayloadMeaningful(snap.payload)
    default:
      return false
  }
}

export function listNonEmptyWorkspaceSnapshots(): WorkspaceSnapshot[] {
  const sources: WorkspacePinSource[] = ['avatar-frame', 'chat', 'ai-matting', 'output-tool']
  const list: WorkspaceSnapshot[] = []
  for (const s of sources) {
    const snap = loadWorkspaceSnapshot(s)
    if (snap && isSnapshotMeaningful(snap)) list.push(snap)
  }
  list.sort((a, b) => b.updatedAt - a.updatedAt)
  return list
}

export function buildHomeArchiveGrid(): HomeGridItem[] {
  const items: HomeGridItem[] = []
  for (const snap of listNonEmptyWorkspaceSnapshots()) {
    items.push({ kind: 'workspace', snap, cardKey: `ws-${snap.source}` })
  }
  const hist = loadHistory()
  for (const entry of [...hist].reverse()) {
    items.push({ kind: 'avatar-history', entry, cardKey: `hist-${entry.id}` })
  }
  items.sort((a, b) => {
    const ta = a.kind === 'workspace' ? a.snap.updatedAt : a.entry.timestamp
    const tb = b.kind === 'workspace' ? b.snap.updatedAt : b.entry.timestamp
    return tb - ta
  })
  return items
}
