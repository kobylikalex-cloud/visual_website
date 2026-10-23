import type { InteractionTarget } from './types'
import type { InteractionTargetRegistry } from './InteractionTargetRegistry'

export const CLICK_TARGET_IDS = ['test-0', 'test-1', 'test-2', 'test-3', 'test-4'] as const

export function eligibleElement(element: HTMLElement): boolean {
  if (!element.isConnected || !element.getClientRects().length || element.matches(':disabled, [aria-disabled="true"]') || element.closest('[inert], [aria-hidden="true"]')) return false
  for (let current: HTMLElement | null = element; current; current = current.parentElement) {
    const style = getComputedStyle(current)
    if (style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0) return false
  }
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0 && rect.right > 0 && rect.bottom > 0 && rect.left < innerWidth && rect.top < innerHeight
}

export function collectTargets(registry: InteractionTargetRegistry, onlyId?: string): InteractionTarget[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-gesture-target]')).flatMap(element => {
    const id = element.dataset.gestureTarget!
    if (onlyId && id !== onlyId) return []
    if (!element.getClientRects().length) return []
    const rect = element.getBoundingClientRect()
    if (rect.width <= 0 || rect.height <= 0 || rect.right <= 0 || rect.bottom <= 0 || rect.left >= innerWidth || rect.top >= innerHeight) return []
    return [{ id, kind: 'click' as const, rect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
      disabled: element.matches(':disabled, [aria-disabled="true"]'), activationToken: registry.tokenFor(id, element) }]
  })
}
