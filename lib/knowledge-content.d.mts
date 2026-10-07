export function canonical(value: unknown): unknown;
export function knowledgePayload(type: 'trade' | 'journal' | 'insight', row: Record<string, unknown>): Record<string, unknown>;
export function fingerprint(type: 'trade' | 'journal' | 'insight', row: Record<string, unknown>): string;
