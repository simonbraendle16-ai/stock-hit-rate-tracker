const list = items => '<ol>' + items.map(item => `<li>${item}</li>`).join('') + '</ol>';
const truths = ['Am Markt kann alles passieren.','Du kannst profitabel handeln, auch wenn du den nächsten Kursverlauf nicht kennst.','Bei einem gegebenen Edge ist die Reihenfolge von Gewinnen und Verlusten zufällig.','Ein Edge bedeutet, dass ein Ausgang wahrscheinlicher ist als ein anderer.','Jeder Moment am Markt ist einzigartig.'];
const principles = ['Ich erkenne meine Setups mit statistischem Vorteil objektiv.','Ich lege das Risiko jedes Trades im Voraus fest.','Ich akzeptiere das Risiko vollständig. Solange ich dazu nicht bereit bin, lasse ich den Trade aus.','Sobald eines meiner Setups vorliegt, handle ich entschlossen.','Ich realisiere Gewinne, wenn der Markt mir die Gelegenheit dazu bietet.','Ich beobachte laufend, wann ich anfällig für Fehler bin.','Ich halte diese Prinzipien konsequent ein, weil sie die Grundlage meiner Beständigkeit sind.'];
const steps = [
['Hoch','Der übergeordnete Trend steigt. Nach dem Hoch setzt der Kurs zurück. Dieses Hoch ist der Ausgangspunkt der Skizze.'],
['Kaufzone','Lege aus der übergeordneten Analyse fest, wo der spätere Kauf in Trendrichtung interessant wird. Im Beispiel liegt diese Zone unter dem aktuellen Kurs.'],
['Gegeneinstieg','Der Kurs erholt sich nach dem ersten Rücksetzer. In dieser Erholung suchst du ein eigenständiges Short-Setup für den Weg nach unten zur Kaufzone.'],
['Bewegung zur Zone','Im Beispiel fällt der Kurs in mehreren Schüben mit kleinen Erholungen. Der Short hat die Kaufzone als Ziel. Für ihn gilt das Geldrisiko des kleinteiligeren Trades.'],
['Ausstieg','Schließe den Short an der oberen Kante der Kaufzone. Dort endet der Gegentrade. Die ursprüngliche Long-Idee wird an dieser Zone separat nach deinem Einstiegsablauf geprüft.']
];
const entrySteps = [
['Große potenzielle Trendwende','Warte auf die Bestätigung durch ein 1→2-Setup. Im Long-Beispiel bildet sich nach dem Tief ein erster Anstieg (1), gefolgt von einem Rücksetzer (2).'],
['Kleinteiligere Trendwende','Der Einstieg liegt direkt in der zuvor bestimmten Trendwendezone. Die Skizze markiert den Eintritt in die Zone.']
];
const sections = [
['douglas','Mark Douglas',`<div class="grid"><div><h3>5 Grundwahrheiten</h3>${list(truths)}</div><div><h3>7 Prinzipien der Beständigkeit</h3>${list(principles)}</div></div><small>Sinngemäß aus <a href="https://www.penguinrandomhouse.com/books/350665/trading-in-the-zone-by-mark-douglas/">Trading in the Zone</a>, Kapitel 7 und 11.</small>`],
['size','Size',`<p class="muted">Geldrisiko pro Trade</p><div class="grid">${[['Swing',25,[20,25,30],['1,50','1,75','2,00']],['Kleinteiligere Trades','12,5',[11,'12,5',15],['0,40','0,50','0,70']]].map(([label,value,range,cash])=>`<div class="card risk"><h3>${label}</h3><strong>${value} $</strong><div class="scale" aria-hidden="true"><i></i><i></i></div><div class="risk-range">${range.map((amount,i)=>`<span>${amount} $<small>${cash[i]} $</small></span>`).join('')}</div></div>`).join('')}</div><details><summary>Zahlen aus der Originalnotiz</summary><p>300 $ = 20 $ · 30 $ = 2 $ · 20 $ = 1,5 $ · 40 $ = 2,6 $ · 10 $ = 0,5 $</p></details>`],
['entry','Einstieg',`${entrySteps.map(([label,copy],i)=>`<article class="chart-story"><div><h3><strong>${i+1}.</strong> ${label}</h3><p>${copy}</p></div><canvas width="800" height="340" role="img" aria-label="Long-Beispiel · ${label}"></canvas></article>`).join('')}`],
['chart','Gigachat-Trick',`<p class="muted">Zwei Ideen im selben Chart. Die Kaufzone gehört zur späteren Long-Idee. Der Short handelt im Beispiel den Weg zu dieser Zone.</p>${steps.map(([label,copy],i)=>`<article class="chart-story"><div><h3><strong>${i+1}.</strong> ${label}</h3><p>${copy}</p></div><canvas width="800" height="390" role="img" aria-label="Schematischer Kursverlauf · ${label}"></canvas></article>`).join('')}<p class="note">Eine Zielzone kann oberhalb oder unterhalb des aktuellen Kurses liegen. Hier zeigt die Skizze den Weg nach unten. Die Originalnotiz schätzt, dass die Zielzone in 90 % der Fälle angelaufen oder durchlaufen wird. Die Schätzung ist unbelegt.</p>`],
['rules','Regeln & Zielüberzeugungen',`<div class="grid"><div><h3>Handelsregeln</h3>${list(['Meine Strategie und mein Vorteil liegen auf größeren Timeframes. Intraday, Scalping und Daytrades lasse ich aus. In meiner Notiz verbrennen sie meinen Gewinn.','Das CRV ist mein größter Freund. Ich halte es realistisch.','Ich verschiebe den Einstieg nicht aus Angst. Die Koordinaten für ein vermeintlich kleineres Risiko zu ändern fühlt sich gut an, kann aber nach hinten losgehen, wie in meinem notierten Tradebeispiel.'])}<h3>Guter Hund? Böser Hund? Doch neutral?</h3><p>Der Markt liefert neutrale Informationen. Ich interpretiere sie sachlich und beobachte meine Emotionen.</p></div><div><h3>Zielüberzeugungen</h3><p>Die Teilnahme am Kapitalmarkt fordert kognitive Fähigkeiten und starke Überzeugungen. Ich entziehe alten, hinderlichen Überzeugungen Aufmerksamkeit und stärke die gewünschte Überzeugung durch positive Erfahrungen, bis sie im Handeln präsent ist.</p>${list(['Ich bin ein beständiger Gewinner.','The goal is to become the best trader possible.','Ich erkenne objektiv meine Strategie und ihren Edge und steige ein, sobald mein Setup auftaucht.','Ich definiere das Geldrisiko vorher und akzeptiere, dass ich falschliegen kann. Ich prüfe meinen Gefühlszustand, den Zweck und ob der Trade meinem Edge entspricht.','Frühere Ergebnisse bestimmen meine aktuelle Entscheidung nicht. Ich nehme die Trades im Rahmen meiner Strategie und richte mich am Now-Moment aus.','Ich bezahle mich selbst, wenn der Markt mir Geld auf den Tisch legt.','Ich überprüfe ständig meine Fehleranfälligkeit.','Ich will über einen messbaren Zeitraum exzellent handeln. Vom Ergebnis eines einzelnen Trades mache ich mich emotional unabhängig.'])}</div></div>`]
];
function renderSection([id,title,body]) {
return `<section id="${id}" aria-labelledby="heading-${id}"><h2 id="heading-${id}">${title}</h2>${body}</section>`;
}
const app = document.querySelector('#app')
app.classList.add('playbook')
const states = [
  ['Niedergeschlagen','#f59a9f','Selbstvorwürfe · Wut · Entmutigung','Achte darauf, ob du ein früheres Ergebnis auf das aktuelle Setup überträgst.'],
  ['Panisch','#ffac80','FOMO · Impulsivität · Tunnelblick','Achte darauf, ob du dem Kurs hinterherläufst oder nur noch einen Ausgang siehst.'],
  ['Frustriert','#f4c383','Gereiztheit · Revanchegedanken · Nachlässigkeit','Prüfe, ob du dem Markt etwas zurückholen willst oder Schritte überspringst.'],
  ['Rechtfertigend','#dce38b','Hoffnung · Ausreden · Abkürzungen','Frage dich, welches konkrete Signal deine Idee stützt und was sie widerlegen würde.'],
  ['Unter Leistungsdruck','#f6a1ce','Unruhe · Ungeduld · Erwartungsdruck','Prüfe, ob du ein Setup siehst oder das Gefühl hast, heute etwas liefern zu müssen.'],
  ['Zögerlich','#9dc8ff','Nervosität · Zweifel · Angst, falschzuliegen oder zu viel zu handeln','Prüfe, ob eine Bestätigung fehlt oder ob du trotz vollständigem Setup Angst hast, falschzuliegen.'],
  ['Fokussiert','#9ce8bd','Ruhe · Zuversicht · Entschlossenheit','Gleiche Setup, Risiko und Invalidierung in Ruhe mit deinem Plan ab.'],
  ['Euphorisch','#d4b2ff','Hochgefühl · Viel Energie · Überschwang','Achte darauf, ob dich ein Gewinn zu größerer Size oder zu zusätzlichen Trades verleitet.']
];
const questions = [
  ['Was spürst du gerade am stärksten?', [['Niedergeschlagen oder wütend',[0,2]],['Angst oder starke Anspannung',[1,5]],['Gereizt oder unruhig',[2,4]],['Hoffnung oder Zuversicht',[3,6]],['Ruhig und klar',[6,5]],['Überdreht oder euphorisch',[7,4]]]],
  ['Was drängt dich zum Handeln oder Zögern?', [['Verlust zurückholen',[2,0]],['Eine Bewegung nicht verpassen',[1,4]],['Heute etwas liefern',[4,3]],['Die Idee irgendwie passend machen',[3,2]],['Angst, falschzuliegen',[5,1]],['Mein Setup abwarten',[6,5]],['Das Hochgefühl nach einem Gewinn',[7,6]]]],
  ['Wie klar kannst du dein Setup beurteilen?', [['Ich sehe gerade nur einen Ausgang',[1,3]],['Ich suche Gründe für meine Idee',[3,4]],['Ich sehe das Setup, zweifle aber',[5,6]],['Ich kann Setup und Invalidierung benennen',[6,5]],['Ich merke, dass ich kaum noch prüfe',[7,2]]]]
];
const moodMarkup = `<form class="mood-form" id="mood-form">${questions.map(([question,options],i)=>`<label>${question}<select required name="answer-${i}"><option value="">Bitte auswählen</option>${options.map(([label],j)=>`<option value="${j}">${label}</option>`).join('')}</select></label>`).join('')}<button>Passende Zustände anzeigen</button></form><p id="mood-suggestions" role="status">Beantworte die drei Fragen oder wähle direkt im Spektrum.</p><div class="spectrum-scroll" tabindex="0" aria-label="Gefühlsspektrum, horizontal scrollbar"><div class="spectrum-board"><h3>Das emotionale Spektrum beim Trading</h3><div class="spectrum">${states.map(([name,color,signs,hint],i)=>`<div class="state" style="--state:${color}"><label><input type="checkbox" value="${i}"><span>${name}</span></label><p class="muted">${signs}</p><small>${hint}</small></div>`).join('')}</div><div class="spectrum-transitions" aria-label="Beispiele für emotionale Übergänge"><div>Impulsiver Verlusttrade</div><div>Eine Gelegenheit taucht auf</div><div>Der Trade wird ausgestoppt</div><div>Trade außerhalb des Plans</div><div>Profitablen Trade ausgelassen</div><div>Großer Gewinn am Ziel</div></div></div></div><small id="mood-status" role="status"></small>`;
const content = sections.map(renderSection).join('');

app.innerHTML = `<section aria-labelledby="mood-title"><h1 id="mood-title">Wie fühle ich mich heute?</h1>${moodMarkup}</section>${content}`;
const moodInputs = [...app.querySelectorAll('input[type=checkbox]')];
const moodStatus = document.querySelector('#mood-status');

const form = document.querySelector('#mood-form');
const suggestion = document.querySelector('#mood-suggestions');
const selects = [...form.querySelectorAll('select')];
function showSuggestions(answers) {
  const scores = states.map(()=>0);
  answers.forEach((answer,i)=>{
    if (answer === '') return;
    questions[i][1][Number(answer)]?.[1].forEach((state,rank)=>scores[state] += 2-rank);
  });
  const matches = scores.map((score,i)=>({score,i})).filter(item=>item.score).sort((a,b)=>b.score-a.score).slice(0,3);
  moodInputs.forEach((input,i)=>input.closest('.state').toggleAttribute('data-suggested',matches.some(item=>item.i===i)));
  suggestion.textContent = matches.length
    ? 'Deine Antworten passen am ehesten zu: '+matches.map(({i})=>states[i][0]).join(', ')+'. Kreuze an, was sich für dich stimmig anfühlt.'
    : 'Beantworte die drei Fragen oder wähle direkt im Spektrum.';
}
const endpoint = '/api/daily-sheet';
const retry = document.createElement('button');
retry.textContent = 'Erneut versuchen';
retry.hidden = true;
moodStatus.after(retry);
let moodDate;
let queue = Promise.resolve();
let failed = {};
let loading = false;

function setControls(enabled) {
  for (const control of [...selects, ...moodInputs, form.querySelector('button')]) {
    control.disabled = !enabled;
  }
}

async function loadMood() {
  if (loading) return;
  loading = true;
  try {
    const response = await fetch(endpoint, { cache: 'no-store' });
    if (!response.ok) throw new Error('Check-in unavailable');
    const { date, answers, states } = await response.json();
    if (moodDate !== date) {
      moodDate = date;
      failed = {};
      retry.hidden = true;
      selects.forEach((select, i) => { select.value = answers[i] ?? ''; });
      moodInputs.forEach(input => { input.checked = states.includes(Number(input.value)); });
      showSuggestions(answers);
      moodStatus.textContent = answers.length || states.length ? 'Heute bereits erfasst.' : 'Mehrfachauswahl für heute.';
    }
    setControls(true);
  } catch {
    if (!moodDate) {
      moodStatus.textContent = 'Der Tagesstand konnte nicht geladen werden.';
      retry.hidden = false;
    }
  } finally {
    loading = false;
  }
}

function saveMood(patch) {
  const date = moodDate;
  queue = queue.then(async () => {
    if (date !== moodDate) return;
    const changes = { ...failed, ...patch };
    try {
      const response = await fetch(endpoint, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, ...changes }),
      });
      if (response.status === 409) {
        await loadMood();
        if (moodDate !== date) return;
      }
      if (!response.ok) throw new Error('Check-in save failed');
      if (date !== moodDate) return;
      failed = {};
      retry.hidden = true;
      moodStatus.textContent = 'Für heute gespeichert.';
    } catch {
      if (date !== moodDate) return;
      failed = changes;
      retry.hidden = false;
      moodStatus.textContent = 'Speichern fehlgeschlagen.';
    }
  });
}

retry.addEventListener('click', () => {
  if (moodDate) saveMood({});
  else void loadMood();
});
setControls(false);
void loadMood();
const checkDay = () => {
  const localDay = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Europe/Berlin', dateStyle: 'short',
  }).format(new Date());
  if (localDay !== moodDate) void loadMood();
};
window.addEventListener('focus', checkDay);
setInterval(checkDay, 15000);

form.addEventListener('submit', event => {
  event.preventDefault();
  const answers = selects.map(select => Number(select.value));
  showSuggestions(answers);
  saveMood({ answers });
});

moodInputs.forEach(input => input.addEventListener('change', () => {
  const states = moodInputs.filter(item => item.checked).map(item => Number(item.value));
  saveMood({ states });
}));
// Coordinates describe schematic price action, not market data.
function plot(canvas, points, { zone, labels = [], shortFrom } = {}) {
  const ctx = canvas.getContext('2d');
  const height = Number(canvas.dataset.logicalHeight);
  const scale = Math.max(2, Math.ceil(canvas.clientWidth * devicePixelRatio / 800));
  canvas.width = 800 * scale;
  canvas.height = height * scale;
  ctx.setTransform(scale, 0, 0, scale, 0, 0);

  const left = 45, right = 770, top = 30, bottom = height - 37;
  ctx.font = '18px Segoe UI';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#aab5c4';
  ctx.fillText('Kurs',left,16);
  ctx.textAlign = 'right';
  ctx.fillText('Zeit →',right,height-16);
  ctx.textAlign = 'left';

  ctx.strokeStyle = '#251d32';
  ctx.beginPath();
  for (let x=left;x<=right;x+=90) { ctx.moveTo(x,top);ctx.lineTo(x,bottom); }
  for (let y=top;y<=bottom;y+=48) { ctx.moveTo(left,y);ctx.lineTo(right,y); }
  ctx.stroke();
  ctx.strokeStyle = '#4d405f';
  ctx.beginPath();ctx.moveTo(left,top);ctx.lineTo(left,bottom);ctx.lineTo(right,bottom);ctx.stroke();

  if (zone) {
    const { y, start } = zone;
    ctx.fillStyle = '#172d30';

    ctx.fillRect(start,y,right-start,32);
    ctx.strokeStyle = '#78ada5';
    ctx.setLineDash([6,5]);
    ctx.beginPath();ctx.moveTo(start,y);ctx.lineTo(right,y);ctx.stroke();
    ctx.setLineDash([]);

  }

  function trace(series,color) {
    ctx.beginPath();
    series.forEach(([x,y],i)=>i ? ctx.lineTo(x,y) : ctx.moveTo(x,y));
    ctx.strokeStyle=color;ctx.lineWidth=3;ctx.lineJoin='round';ctx.lineCap='round';ctx.stroke();
  }
  trace(points,'#9468cd');
  if (shortFrom != null) trace(points.slice(shortFrom),'#e3b888');

  const occupied = [];
  function placeLabel(label, candidates, color, anchor) {
    const metrics = ctx.measureText(label);
    const boxAt = ([x,y]) => ({
      x: x - metrics.width / 2 - 6,
      y: y - metrics.fontBoundingBoxAscent - 4,
      right: x + metrics.width / 2 + 6,
      bottom: y + metrics.fontBoundingBoxDescent + 4
    });
    const crossesPrice = box => points.slice(1).some(([x2,y2],i)=>{
      const [x1,y1] = points[i];
      const low = Math.max(box.x,x1), high = Math.min(box.right,x2);
      if (low > high) return false;
      const yAt = x => y1 + (y2-y1)*(x-x1)/(x2-x1);
      return Math.max(yAt(low),yAt(high)) >= box.y && Math.min(yAt(low),yAt(high)) <= box.bottom;
    });
    if (anchor) {
      const [x,y] = anchor;
      const distance = candidate => {
        const box = boxAt(candidate);
        return Math.hypot(Math.max(box.x-x,x-box.right,0),Math.max(box.y-y,y-box.bottom,0));
      };
      candidates.sort((a,b)=>distance(a)-distance(b));
    }
    const position = candidates.find(candidate=>{
      const box = boxAt(candidate);
      return box.x >= left && box.right <= right && box.y >= top && box.bottom <= bottom &&
        !crossesPrice(box) && !occupied.some(other=>box.x<other.right && box.right>other.x && box.y<other.bottom && box.bottom>other.y);
    });
    if (!position) return;
    occupied.push(boxAt(position));
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(label,...position);
    ctx.textAlign = 'left';
    return boxAt(position);
  }

  ctx.font = '20px Segoe UI';
  if (zone) {
    const middle = (zone.start + right) / 2;
    placeLabel(zone.label,[[middle,zone.y+19],[middle+80,zone.y+19],[middle-80,zone.y+19],[middle,zone.y-26]],'#b7e0d8');
  }

  labels.forEach(([index,label,side='above',color='#f0debc'])=>{
    const [x,y] = points[index];
    ctx.font = '600 20px Segoe UI';
    const half = ctx.measureText(label).width/2+7;
    const sign = side==='below' ? 1 : -1;
    const candidates = [18,-18,24,-24,32,-32,45,-45,60,-60,80,-80,100,-100,130,-130,170,-170].flatMap(offset=>
      [0,-22,22,-45,45,-65,65,-90,90,-145,145,-210,210,-300,300].map(dx=>[Math.max(left+half,Math.min(right-half,x+dx)),y+sign*offset])
    );
    const position = placeLabel(label,candidates,color,[x,y]);
    if (position) {
      const labelX = Math.max(position.x, Math.min(position.right,x));
      const labelY = Math.max(position.y, Math.min(position.bottom,y));
      ctx.strokeStyle=color;ctx.lineWidth=1;
      ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(labelX,labelY);ctx.stroke();
    }
    ctx.beginPath();ctx.arc(x,y,5,0,Math.PI*2);ctx.fillStyle=color;ctx.fill();
  });
}

const chartObserver = new ResizeObserver(entries=>{
  entries.forEach(({target})=>chartRenderers.get(target)());
});
const chartRenderers = new Map();
function mountChart(canvas,points,options) {
  canvas.dataset.logicalHeight = canvas.height;
  canvas.style.aspectRatio = '800 / '+canvas.height;
  const redraw = ()=>plot(canvas,points,options);
  chartRenderers.set(canvas,redraw);
  redraw();
  chartObserver.observe(canvas);
}

const entryPrices = [[55,85],[96,102],[135,126],[179,111],[218,143],[249,137],[299,181],[347,195],[379,220],[431,195],[471,234],[511,266],[549,278],[578,246],[608,225],[635,176],[664,153],[691,177],[717,173],[752,208]];
const entryPlots = [
  { count:20, labels:[[12,'Tief','below'],[16,'1 · Erster Anstieg'],[19,'2 · Rücksetzer','below']] },
  { count:9, zone:{y:208,start:280,label:'Trendwendezone'}, labels:[[8,'Einstieg in der Zone']] }
];
app.querySelectorAll('#entry canvas').forEach((canvas,index)=>{
  const {count,...options} = entryPlots[index];
  mountChart(canvas,entryPrices.slice(0,count),options);
});

const gigachatPrices = [[55,303],[92,271],[118,278],[151,243],[170,250],[202,194],[227,171],[252,181],[271,164],[291,118],[317,124],[341,80],[368,115],[394,162],[422,180],[455,146],[481,153],[507,119],[530,162],[552,175],[573,158],[600,214],[622,205],[646,247],[667,234],[693,276],[717,266],[752,307]];
const buyZone = {y:307,start:345,label:'Kaufzone der Long-Idee'};
const gigachatPlots = [
  {count:15,labels:[[11,'Hoch']]},
  {count:15,zone:buyZone},
  {count:18,zone:buyZone,labels:[[17,'Möglicher Short-Einstieg']]},
  {count:26,zone:buyZone,shortFrom:17,labels:[[21,'Bewegung zur Kaufzone']]},
  {count:28,zone:buyZone,shortFrom:17,labels:[[27,'Short-Ausstieg']]}
];
app.querySelectorAll('#chart canvas').forEach((canvas,index)=>{
  const {count,...options} = gigachatPlots[index];
  mountChart(canvas,gigachatPrices.slice(0,count),options);
});
