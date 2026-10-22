// User decision 2026-10-22: retire the unused trainer to avoid its DB reads.
// Shared literal keeps server enforcement and bundled navigation consistent.
// Historical rows stay intact; re-enabling is a deliberate code/deployment change.
export const TRAINER_ENABLED = false

export function requireTrainerEnabled() {
  if (!TRAINER_ENABLED) throw new Error('Der Trainer ist deaktiviert.')
}
