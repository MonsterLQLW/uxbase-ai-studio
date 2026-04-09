export type OutputToolTemplate = {
  background: {
    top: string
    mid: string
    bottom: string
    haze: number
  }
  character: {
    scale: number
    offsetX: number
    offsetY: number
  }
  layer7: {
    tint: string
    /** 并行紫线 7 号着色（与蓝线共用素材，仅着色不同） */
    tintPurple: string
  }
  logo: {
    width: number
    height: number
    margin: number
    glow: {
      enabled: boolean
      color: string
      size: number
      opacity: number
    }
  }
}

/**
 * 输出工具默认模板（当前你确认的“一键输出默认状态”）。
 * 后续要换模板，只需要改这份数据即可。
 */
export const DEFAULT_OUTPUT_TOOL_TEMPLATE: OutputToolTemplate = {
  background: {
    top: '#9FD6F5',
    mid: '#0D3A75',
    bottom: '#041327',
    haze: 0.8,
  },
  character: {
    scale: 1.6,
    offsetX: 0,
    offsetY: 0,
  },
  layer7: {
    tint: '#11204A', // 来自当前模板截图（蓝线）
    tintPurple: '#4A2A6E', // 深紫着色层（参考对比图）
  },
  logo: {
    width: 116,
    height: 60,
    margin: 14,
    glow: {
      enabled: true,
      // 取自截图中“外发光颜色”色块（近似取样）
      color: '#08142A',
      size: 5,
      opacity: 0.2,
    },
  },
}

