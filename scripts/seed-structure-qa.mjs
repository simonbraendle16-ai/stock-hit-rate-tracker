// Isolated in-memory S6 population; never connect to a personal database.
export async function seedStructure(database,owner) {
  for(let i=1;i<=48;i++) {
    const wave=i<=24?'4':i<=40?'B':'C';
    const evidence={provenance:'Synthetic S6 QA only',catalogueVersion:1,waveDirection:'short',
      reversalLocation:i%3?'at_level':'between_levels',reversalZone:i%3?[61.8,61.8]:[61.8,88.7],
      structureCode:i%2?'abc':'abc_zigzag',structureConfidence:i%7?'bestaetigt':'vermutet',
      subdivision:i%2?'three_part':'five_part',subdivisionConfidence:i%8?'bestaetigt':'vermutet',
      ...(wave==='B'?{waveVariant:i%2?'b_overshooting':'b_undershooting'}:wave==='C'?{waveVariant:'c_truncated'}:{}),
    };
    const id=`76000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
    await database.query(`INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,percent,"measurementKind",note,evidence)
      VALUES($1,$1,$2,1,$3,$4,$5,'2026-10-22',$6,NULL,$7,'Synthetic S6 QA case – no market data.',$8)`,
      [id,owner,wave,i>44?'Primär':'Minor',i>44?'1w':'1d',i===21?'laufend':i===22?'unklar':i===23?'ungueltig':'abgeschlossen',i>40?'expansion':'retracement',JSON.stringify(i===24?{provenance:'Synthetic missing grounds'}:evidence)]);
  }
}
