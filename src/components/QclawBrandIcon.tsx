/**
 * QClaw 品牌图标（public/qclaw-icon.png），圆形裁剪展示。
 */
export default function QclawBrandIcon({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <img
      src="/qclaw-icon.png"
      alt=""
      width={40}
      height={40}
      decoding="async"
      className={`rounded-full object-cover object-center ${className}`}
      aria-hidden
    />
  )
}
