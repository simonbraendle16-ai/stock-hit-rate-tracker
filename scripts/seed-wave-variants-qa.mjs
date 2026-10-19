// In-memory synthetic preview only; no environment files or production access.
export async function seedWaveVariants(database,owner) {
  if(owner !== 'fibonacci-local-qa') throw Error('Synthetic owner required');
  const rows=[['B','b_overshooting'],['B','b_undershooting'],['C','c_truncated'],['B',null]];
  for(const [i,[wave,waveVariant]] of rows.entries()) {
    const id='71000000-0000-4000-8000-'+String(i+1).padStart(12,'0');
    await database.query(`INSERT INTO fibonacci_observation(id,"contextId","userId","stockId",wave,degree,timeframe,"observedOn",status,percent,note,evidence) VALUES($1,$1,$2,1,$3,'Minor','1d','2026-10-19','abgeschlossen',NULL,'Synthetic wave variant QA; no market data',$4)`,[id,owner,wave,JSON.stringify({catalogueVersion:1,waveVariant,provenance:'Synthetic wave variant QA only'})]);
  }
}
