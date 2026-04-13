export type StageDataUrlImage = { dataUrl: string; name: string }

export type StageTplId = 'a' | 'b'

export type StageGlow = {
  enabled: boolean
  color: string
  size: number
  opacity: number
}

export type StageRootData = {
  title: string
  /** 舞台层·角色层共用图 */
  sharedCharacter: StageDataUrlImage | null
  /** 元素层参考图（根节点 stageElement，可选） */
  stageElement: StageDataUrlImage | null
}

/** 舞台层与各图层之间的收口：一路进、多路出（仅构图与命名，渲染仍读 stRoot 供图） */
export type StageTemplateHubData = {
  title: string
  tpl: StageTplId
  /** 模板名称（标注用，可写入导出文件名前缀等扩展） */
  templateName: string
}

export type StageBottomData = {
  title: string
  tpl: StageTplId
  /** 叠放级 1–7，数字越大越在上层 */
  zLevel: number
  mode: 'solid' | 'image'
  color: string
  image: StageDataUrlImage | null
  linkedColorSource: string | null
}

export type StageCharacterData = {
  title: string
  tpl: StageTplId
  /** 叠放级 1–7，数字越大越在上层 */
  zLevel: number
  offsetX: number
  offsetY: number
  scale: number
}

/** 控制舞台层「元素层」图的位置/缩放（图源来自 stRoot.stageElement） */
export type StageStageElmData = {
  title: string
  tpl: StageTplId
  /** 叠放级 1–7，数字越大越在上层 */
  zLevel: number
  offsetX: number
  offsetY: number
  scale: number
}

export type StageMaskData = {
  title: string
  tpl: StageTplId
  /** 叠放级 1–7，数字越大越在上层 */
  zLevel: number
  color: string
  opacity: number
  linkedColorSource: string | null
  /** 与戳戳遮罩一致：全幅底图，默认可用内置白底图 */
  maskLayer: StageDataUrlImage
  reach: number
  falloff: number
}

export type StageElementData = {
  title: string
  tpl: StageTplId
  /** 叠放级 1–7，数字越大越在上层 */
  zLevel: number
  layer: StageDataUrlImage | null
  offsetX: number
  offsetY: number
  scale: number
  linkedColorSource: string | null
  linkedGlowSource: string | null
}

export type StageFontData = {
  title: string
  tpl: StageTplId
  /** 叠放级 1–7，数字越大越在上层 */
  zLevel: number
  text1: string
  text2: string
  fontSize: number
  fontFamily: string
  color: string
  linkedColorSource: string | null
  linkedGlowSource: string | null
}

export type StageColorNodeData = {
  title: string
  tpl: StageTplId
  color: string
  presets: string[]
}

export type StageGlowNodeData = {
  title: string
  tpl: StageTplId
  glow: StageGlow
}

export type StagePreviewData = {
  title: string
  tpl: StageTplId
  width: number
  height: number
  fileName: string
}

export type StageBatchData = {
  title: string
}

export type StageFlowNodeData =
  | { type: 'stRoot'; payload: StageRootData }
  | { type: 'stTemplateHub'; payload: StageTemplateHubData }
  | { type: 'stBottom'; payload: StageBottomData }
  | { type: 'stCharacter'; payload: StageCharacterData }
  | { type: 'stMask'; payload: StageMaskData }
  | { type: 'stElement'; payload: StageElementData }
  | { type: 'stFont'; payload: StageFontData }
  | { type: 'stColor'; payload: StageColorNodeData }
  | { type: 'stGlow'; payload: StageGlowNodeData }
  | { type: 'stPreview'; payload: StagePreviewData }
  | { type: 'stBatch'; payload: StageBatchData }
