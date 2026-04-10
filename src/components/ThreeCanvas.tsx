import { Canvas } from '@react-three/fiber'
import { OrbitControls, Float } from '@react-three/drei'

function FloatingObject() {
  return (
    <Float speed={2} rotationIntensity={1.5} floatIntensity={2}>
      <mesh>
        <icosahedronGeometry args={[1, 1]} />
        <meshStandardMaterial
          color="#6366f1"
          metalness={0.6}
          roughness={0.2}
        />
      </mesh>
    </Float>
  )
}

function FloatingRing() {
  return (
    <Float speed={1.5} rotationIntensity={0.5} floatIntensity={1.5}>
      <mesh rotation={[Math.PI / 4, 0, 0]}>
        <torusGeometry args={[1.6, 0.05, 16, 100]} />
        <meshStandardMaterial color="#818cf8" metalness={0.8} roughness={0.2} />
      </mesh>
    </Float>
  )
}

function FloatingRing2() {
  return (
    <Float speed={1} rotationIntensity={0.8} floatIntensity={1}>
      <mesh rotation={[-Math.PI / 6, Math.PI / 4, 0]}>
        <torusGeometry args={[2.2, 0.03, 16, 100]} />
        <meshStandardMaterial color="#a78bfa" metalness={0.8} roughness={0.2} />
      </mesh>
    </Float>
  )
}

export default function ThreeCanvas() {
  return (
    <div className="w-full h-full">
      <Canvas
        camera={{ position: [0, 0, 5], fov: 50 }}
        gl={{
          antialias: true,
          powerPreference: 'low-power', // 降低GPU功耗，防止崩溃
          failIfMajorPerformanceCaveat: true,
        }}
        dpr={[1, 1.5]} // 限制像素比，防止显存爆炸
      >
        <color attach="background" args={['#0f172a']} />
        <ambientLight intensity={0.3} />
        <directionalLight position={[10, 10, 5]} intensity={1} color="#ffffff" />
        <pointLight position={[-10, -10, -5]} intensity={0.5} color="#818cf8" />
        <FloatingObject />
        <FloatingRing />
        <FloatingRing2 />
        <OrbitControls enableZoom={false} autoRotate autoRotateSpeed={0.5} />
      </Canvas>
      <div className="absolute bottom-4 left-4 text-xs text-slate-500">
        拖拽旋转
      </div>
    </div>
  )
}
