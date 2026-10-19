// Called only by the in-memory local preview; never imports environment files.
export async function seedDurationDefinitions(database,owner) {
  if(owner !== 'fibonacci-local-qa') throw Error('Synthetic owner required');
  const base={catalogueVersion:1,waveDirection:'short',targetZone:[50,61.8],targetContact:'reached',provenance:'Synthetic duration definition QA only'};
  const rows=[
    ['1',{...base,targetZoneReversal:{kind:'exact',value:6,unit:'hour',timeBasis:'calendar',measurementConvention:'first_entry_to_pivot',zone:[50,61.8],originalText:'Synthetic six hours to pivot'},
      targetZoneResidence:{kind:'exact',value:18,unit:'hour',timeBasis:'calendar',measurementConvention:'first_visit',zone:[50,61.8],originalText:'Synthetic eighteen hours inside zone',touchAndGo:false},
      durations:{wave:{bucket:'d3_7',timeBasis:'calendar',convention:'whole_wave'},reversal:{bucket:'h4_12',timeBasis:'calendar',convention:'first_entry_to_pivot',zone:[50,61.8]},residence:{bucket:'h12_24',timeBasis:'calendar',convention:'first_visit',zone:[50,61.8]}}}],
    ['2',{...base,reversalDurationDays:2,durations:{reversal:{bucket:'d1_3',timeBasis:'trading',convention:'reversal'}}}],
  ];
  for(const [suffix,evidence] of rows) {
    const id='69000000-0000-4000-8000-'+suffix.padStart(12,'0');
    await database.query(`INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,percent,note,evidence) VALUES($1,$1,$2,1,'4','Minor','1h','2026-10-19','abgeschlossen',NULL,'Synthetic duration definitions QA; no market data',$3)`,[id,owner,JSON.stringify(evidence)]);
  }
}
