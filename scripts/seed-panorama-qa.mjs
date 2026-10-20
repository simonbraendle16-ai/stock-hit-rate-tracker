// In-memory local QA only. No personal account or market observations.
export async function seedPanorama(database,owner) {
  for (let i=1;i<=48;i++) {
    const kind=i>40?'expansion':'retracement';
    const status=i===38?'laufend':i===39?'unklar':i===40?'ungueltig':'abgeschlossen';
    const evidence=i===37?{provenance:'Synthetic missing grounds'}:{
      provenance:'Synthetic S4 QA only',catalogueVersion:1,waveDirection:'short',
      reversalLocation:i%3?'at_level':'between_levels',reversalZone:i%3?[61.8,61.8]:[61.8,88.7],
      reachedLevels:[38.2,50],missedLevels:[100],structureCode:i%2?'abc':'abc_zigzag',
      subdivision:i%2?'three_part':'five_part',subdivisionConfidence:i===36?'vermutet':'bestaetigt',structureConfidence:'bestaetigt',
      targetZone:[50,61.8],expectationTiming:i%2?'prior':'retrospective',
      waveVariant:i%2?'b_overshooting':'b_undershooting',
    };
    const id=`74000000-0000-4000-8000-${String(i).padStart(12,'0')}`;
    await database.query(`INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,percent,"measurementKind",note,evidence)
      VALUES($1,$1,$2,1,'B','Minor','1d','2026-10-20',$3,NULL,$4,'Synthetic S4 QA case – no market data.',$5)`,[id,owner,status,kind,JSON.stringify(evidence)]);
  }
}
