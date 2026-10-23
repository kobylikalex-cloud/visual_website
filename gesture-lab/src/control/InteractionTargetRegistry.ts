export type ActivationRequest = { id: string; token: number; sequence: number }
type Entry = { owner: object; token: number; eligible: () => boolean; activate: () => void }

/** Registered application actions only. No DOM dispatch or system mouse input. */
export class InteractionTargetRegistry {
  private entries = new Map<string, Entry>()
  private nextToken = 0
  private lastSequence = 0

  register(id: string, owner: object, eligible: () => boolean, activate: () => void) {
    const entry = { owner, token: ++this.nextToken, eligible, activate }
    this.entries.set(id, entry)
    return { token: entry.token, unregister: () => { if (this.entries.get(id) === entry) this.entries.delete(id) } }
  }

  tokenFor(id: string, owner: object) {
    const entry = this.entries.get(id)
    return entry?.owner === owner && entry.eligible() ? entry.token : undefined
  }

  activate(request: ActivationRequest): boolean {
    if (!Number.isSafeInteger(request.sequence) || request.sequence <= this.lastSequence) return false
    // Consume rejected requests as well; a removed target must not recover later.
    this.lastSequence = request.sequence
    const entry = this.entries.get(request.id)
    if (!entry || entry.token !== request.token || !entry.eligible()) return false
    entry.activate()
    return true
  }
}
