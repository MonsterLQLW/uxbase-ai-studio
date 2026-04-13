import type { MouseEvent } from 'react'
import { BaseEdge, getBezierPath, useReactFlow, type EdgeProps } from 'reactflow'

/** 戳戳工作流：右键连线可断开（删除该边） */
export function PokeDeletableBezierEdge(props: EdgeProps) {
  const {
    id,
    sourceX,
    sourceY,
    targetX,
    targetY,
    sourcePosition,
    targetPosition,
    style,
    markerEnd,
  } = props
  const [edgePath] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  })
  const { setEdges } = useReactFlow()

  const onContextMenu = (e: MouseEvent<SVGPathElement>) => {
    e.preventDefault()
    e.stopPropagation()
    setEdges(eds => eds.filter(edge => edge.id !== id))
  }

  return (
    <>
      <BaseEdge path={edgePath} markerEnd={markerEnd} style={style} />
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        className="react-flow__edge-interaction"
        style={{ pointerEvents: 'stroke', cursor: 'context-menu' }}
        onContextMenu={onContextMenu}
      />
    </>
  )
}
