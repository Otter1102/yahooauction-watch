/** デバイス固有のフィンガープリントを生成（再インストール後も同一値） */
export function getDeviceFingerprint(): string {
  if (typeof window === 'undefined') return ''
  const components = [
    screen.width,
    screen.height,
    screen.colorDepth,
    navigator.language,
    navigator.hardwareConcurrency ?? 0,
    Intl.DateTimeFormat().resolvedOptions().timeZone,
    navigator.platform ?? '',
  ].join('|')
  let hash = 0
  for (let i = 0; i < components.length; i++) {
    const c = components.charCodeAt(i)
    hash = ((hash << 5) - hash) + c
    hash = hash & hash
  }
  return `fp_${Math.abs(hash).toString(36)}`
}

export const IS_TRIAL = process.env.NEXT_PUBLIC_TRIAL_MODE === 'true'
