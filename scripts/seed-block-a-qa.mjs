// Only called by the in-memory local QA launcher; no production configuration.
export async function seedBlockA(database,owner) {
  await database.query(`INSERT INTO portfolio(id,"userId",name,kind,currency) VALUES
    (1,$1,'Synthetic demo','demo','EUR'),(2,$1,'Synthetic real','echtgeld','EUR')`,[owner]);
  await database.query(`INSERT INTO trade(id,"userId","portfolioId","stockId",ticker,status,direction,"entryPrice","stopLoss","takeProfit","positionSize","investedAmount","actualExitPrice",result,"feeEntry","feeExit","tradedWithMoney","quoteCurrency","accountCurrency","quoteToAccountRate","riskRewardRatio") VALUES
    (1,$1,1,1,'FIBQA-S','abgeschlossen','long',100,90,120,1,100,120,'gewinn',0,0,true,'EUR','EUR',1,2),
    (2,$1,2,1,'FIBQA-S','abgeschlossen','long',100,90,120,1,100,90,'verlust',0,0,false,'EUR','EUR',1,2),
    (3,$1,1,1,'FIBQA-S','geplant','long',100,90,120,1,100,NULL,NULL,NULL,NULL,false,'EUR','EUR',1,2)`,[owner]);
  await database.query(`UPDATE fibonacci_observation SET version=version+1,structure='ABC',evidence=$2 WHERE "userId"=$1 AND status='laufend'`,[owner,JSON.stringify({
    provenance:'Synthetic block A QA',waveDirection:'short',periodLabel:'ca. 2008',reachedLevels:[38.2],targetZone:[38.2,61.8],
    hypotheticalCRV:4.5,hypotheticalExitLevel:100,hypotheticalCRVBasis:'Documented hypothetical plan while the wave is running',
    durationDays:8,targetZoneResidence:{kind:'upper_bound',upper:1,upperInclusive:false,touchAndGo:null,unit:'day',timeBasis:'calendar',measurementConvention:null,zone:[38.2,61.8],originalText:'unter einem Tag'},
  })]);
  await database.query(`UPDATE fibonacci_observation SET version=version+1,"tradeId"=1,"hypotheticalOutcome"='gewinn' WHERE id=(SELECT id FROM fibonacci_observation WHERE "userId"=$1 AND "stockId"=1 AND status='abgeschlossen' ORDER BY id LIMIT 1)`,[owner]);
}
