import type { InputHTMLAttributes } from 'react'

/**
 * 用于 React Flow 自定义节点内的 range：避免画布平移、节点拖动、框选抢走指针，左键可顺畅拖拽滑块。
 * 在非 Flow 场景使用也无副作用。
 */
export function RfRangeInput({
  className = '',
  onPointerDown,
  onMouseDown,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  return (
    <input
      type="range"
      className={['nodrag nopan cursor-pointer touch-manipulation', className].filter(Boolean).join(' ')}
      onPointerDown={e => {
        e.stopPropagation()
        onPointerDown?.(e)
      }}
      onMouseDown={e => {
        e.stopPropagation()
        onMouseDown?.(e)
      }}
      {...props}
    />
  )
}
