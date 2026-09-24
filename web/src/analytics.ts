// US-018: every usage event goes through here. No provider yet, so this is a no-op.
// When one is chosen it must be cookieless and receive no personal data.
export type EventName =
  | 'course_opened'
  | 'degree_selected'
  | 'node_inspected'
  | 'subject_marked'
  | 'program_toggled'
  | 'search_used'
  | 'plan_shared';

export function track(event: EventName, props: Record<string, string> = {}): void {
  if (import.meta.env.DEV) console.debug('[track]', event, props);
}
