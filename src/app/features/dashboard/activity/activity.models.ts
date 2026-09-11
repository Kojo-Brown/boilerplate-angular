/** What happened to a resource. */
export type ActivityAction = 'created' | 'updated' | 'deleted' | 'viewed' | 'exported';

/** One line of the audit trail. */
export interface ActivityEntry {
  readonly id: string;
  /** 1-based position in the log, newest first. The default ordering, and a stable tiebreak. */
  readonly sequence: number;
  /** ISO-8601, always UTC — see `ActivityLogComponent` on why it is rendered that way too. */
  readonly occurredAt: string;
  readonly actor: string;
  readonly action: ActivityAction;
  readonly resource: string;
  /** How long the request behind the entry took, in milliseconds. */
  readonly durationMs: number;
}

/** The columns the activity log can be sorted by. */
export type ActivitySortKey = 'sequence' | 'occurredAt' | 'actor' | 'action' | 'durationMs';
