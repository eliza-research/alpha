import assert from 'node:assert/strict';
import type { ActionJournal, JournalEntry } from '../../apps/app/src/runtime/device-actions.ts';

export function entryFor(entries: Map<string, JournalEntry>, proposalId: string): JournalEntry {
 const entry = entries.get(proposalId);
 assert.ok(entry, `Expected a journal entry for ${proposalId}`);
 return entry;
}
export function memoryJournal(entries: Map<string, JournalEntry>): ActionJournal {
 return {
  reserve: async input => {
   const existing = entries.get(input.proposalId);
   if (existing) return { created: false, entry: existing };
   const entry: JournalEntry = { ...input, phase: 'reserved' };
   entries.set(input.proposalId, entry);
   return { created: true, entry };
  },
  markApplying: async input => {
   const entry = entryFor(entries, input.proposalId);
   assert.equal(entry.phase, 'reserved');
   Object.assign(entry, { phase: 'applying', attemptId: input.attemptId });
  },
  finish: async input => {
   const entry = entryFor(entries, input.proposalId);
   assert.equal(entry.phase, 'applying');
   Object.assign(entry, input, { phase: 'terminal' });
  },
  list: async () => ({ entries: [...entries.values()] }),
  get: async input => ({ entry: entries.get(input.proposalId) ?? null }),
 };
}
