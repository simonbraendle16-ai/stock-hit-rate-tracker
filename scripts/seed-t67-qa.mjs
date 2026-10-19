// In-memory QA only, called by fibonacci-local-preview.mjs --t67.
export async function seedT67(database,owner) {
  await database.query(`UPDATE stock SET name='Tesla QA',ticker='TSLA-QA' WHERE id=1`);
  await database.query(`UPDATE stock SET name='Tesla Alternative QA',ticker='TES-QA' WHERE id=2`);
  for(let i=1;i<=50;i++) {
    const id=`67000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
    const evidence={catalogueVersion:1,waveDirection:'short',structureCode:'abc',reversalLocation:'at_level',reversalZone:[61.8,61.8],targetZone:[50,61.8],
      historicalTime:{start:{precision:'year',date:'2021'},end:{precision:'year',date:'2021'}},
      durations:{wave:{bucket:'d3_7',timeBasis:'calendar',convention:'whole_wave'},residence:{bucket:'h4_12',timeBasis:'calendar',convention:'first_visit',zone:[50,61.8]}},
      targetZoneResidence:{kind:'exact',value:8,unit:'hour',timeBasis:'calendar',measurementConvention:'first_visit',zone:[50,61.8],touchAndGo:false,originalText:'Synthetic eight hours'},
      provenance:'Synthetische isolierte T6/T7-Prüfung, keine Marktdaten.'};
    if(i===48)evidence.parentId='67000000-0000-4000-8000-000000000001';
    if(i===49) {delete evidence.reversalLocation;delete evidence.reversalZone;evidence.reachedLevels=[61.8];}
    await database.query(`INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,percent,note,evidence)
      VALUES($1,$1,$2,1,$3,$4,$5,$6,$7,NULL,'Synthetischer T6/T7-Prüffall – keine echten Marktdaten.',$8)`,
      [id,owner,i===48?'A':'4',i%3?'Minor':'Primär',i%3?'1d':'1w',`2026-09-${String((i-1)%28+1).padStart(2,'0')}`,i===50?'laufend':'abgeschlossen',JSON.stringify(evidence)]);
  }
}
