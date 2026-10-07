// Shared contract. Byte-identical copy in tracker lib/knowledge-content.mjs.
import { createHash } from 'node:crypto';
export function canonical(value) {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
const pick = (row, fields) => Object.fromEntries(fields.filter(k => row[k] !== undefined).map(k => [k, row[k]]));
const tradeFields = ['id', 'version', 'ticker', 'direction', 'status', 'notes', 'strategy', 'setupTags', 'planContext', 'elliottWaveCount', 'waveDegree',
  'elliottInvalidation', 'preTradeAnswers', 'moodEntryNote', 'moodExitNote', 'noTradeNote', 'externalSource'];
const journalFields = ['id', 'version', 'tradeId', 'occurredAt', 'kind', 'situation', 'intention', 'action', 'thoughts', 'reflection', 'ruleRef', 'sourceRefs'];
const insightFields = ['id', 'version', 'statement', 'area', 'status', 'evidenceRefs', 'counterEvidenceRefs', 'limits', 'proposal'];
const safeChild = row => Object.fromEntries(Object.entries(row).filter(([key]) => !['userId', 'requestHash', 'requestKey', 'externalRequestHash', 'externalRequestKey'].includes(key)));
const sorted = rows => [...(rows ?? [])].sort((a, b) => String(a.id).localeCompare(String(b.id))).map(safeChild);
export function knowledgePayload(type, row) {
  if (type === 'trade') return canonical({ ...pick(row, tradeFields), events: sorted(row.events), targets: sorted(row.targets), eventRevisions: sorted(row.eventRevisions) });
  if (type === 'journal') return canonical(pick(row, journalFields));
  if (type === 'insight') return canonical(pick(row, insightFields));
  throw new Error('Unbekannter Wissenstyp');
}
export function fingerprint(type, row) {
  return createHash('sha256').update(JSON.stringify(knowledgePayload(type, row))).digest('hex');
}
