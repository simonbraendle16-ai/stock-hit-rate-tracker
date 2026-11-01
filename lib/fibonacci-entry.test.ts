import { describe, expect, it } from 'vitest';
import { entryEvidence, newEntryEvidence, parseEntryDate, replaceEntryDate } from './fibonacci-entry';
import { validateFibInput } from './fibonacci';

describe('Fast wave entry: dates and historical preservation',()=>{
  it.each([
    ['2024','2024','year'],['03.2024','2024-03','month'],['3.2024','2024-03','month'],
    ['29.02.2024','2024-02-29','day'],['2024-02-29','2024-02-29','day'],['2024-03','2024-03','month'],
    [' 1.3.2024 ','2024-03-01','day'],['0001','0001','year'],
  ])('parses %s without fabricated date parts',(raw,date,precision)=>expect(parseEntryDate(raw)).toEqual({date,precision}));
  it.each(['2023-02-29','31.04.2024','00.2024','2024-13','2024-','202','1/2/2024','2024-2-1','0000','ca. 2024'])('rejects invalid/incomplete/ambiguous %s',raw=>expect(()=>parseEntryDate(raw)).toThrow());
  it('empty is unknown',()=>expect(parseEntryDate('  ')).toBeNull());
  const old={precision:'month' as const,date:'2024-03',approximate:true,earliest:'2024-02-01',latest:'2024-04-30'};
  it('preserves all historical bounds on formatting-only edits',()=>expect(replaceEntryDate(old,'03.2024')).toBe(old));
  it('clears only the deliberately replaced boundary metadata',()=>expect(replaceEntryDate(old,'04.2024')).toEqual({precision:'month',date:'2024-04'}));
  it('can explicitly clear an old boundary',()=>expect(replaceEntryDate(old,'')).toBeNull());
});

describe('Fast wave entry: confidence defaults are not historical reclassification',()=>{
  it('defaults both selectors to confirmed',()=>expect(newEntryEvidence()).toMatchObject({structureConfidence:'bestaetigt',subdivisionConfidence:'bestaetigt'}));
  it('does not send confidence without any structure',()=>{
    const e=entryEvidence(newEntryEvidence(),true);
    expect(e).not.toHaveProperty('structureConfidence');expect(e).not.toHaveProperty('subdivisionConfidence');
  });
  it('unknown structure is not a confirmed structure',()=>{
    const e=entryEvidence({...newEntryEvidence(),structureCode:'unknown',subdivision:'unknown'},true);
    expect(e).not.toHaveProperty('structureConfidence');expect(e).not.toHaveProperty('subdivisionConfidence');
  });
  it('retains explicit uncertainty and separate confidence dimensions',()=>{
    const e=entryEvidence({...newEntryEvidence(),structureCode:'abc',structureConfidence:'vermutet',subdivision:'five_part',subdivisionConfidence:'unbekannt'},true);
    expect(e.structureConfidence).toBe('vermutet');expect(e.subdivisionConfidence).toBe('unbekannt');
  });
  it('leaves historical evidence exactly as stored',()=>{
    const old={structureCode:'abc' as const,subdivision:'three_part' as const};
    expect(entryEvidence(old,false)).toBe(old);expect(entryEvidence(old,false)).not.toHaveProperty('structureConfidence');
  });
  it('uses the existing validator and keeps a duration class categorical',()=>{
    const e=entryEvidence({...newEntryEvidence(),structureCode:'abc',subdivision:'three_part',waveDirection:'long',durations:{wave:{bucket:'d3_7',timeBasis:'calendar',convention:'whole_wave'}}},true);
    const row=validateFibInput({stockId:1,wave:'4',timeframe:'1d',degree:'Minor',status:'abgeschlossen',measurementKind:'retracement',observedOn:'2026-11-01',evidence:e});
    expect(row.evidence?.durations?.wave?.bucket).toBe('d3_7');expect(row.evidence?.durationDays).toBeUndefined();
  });
});
