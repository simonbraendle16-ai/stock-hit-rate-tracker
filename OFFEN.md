# Eingerichtet — Stand 02.08.2026 (Etappe 14 „Einstiegs-Signal")

**Die Einrichtung steht.** Takt, Zustellung und Wecker sind belegt; offen ist nur noch
der Nachweis am ersten echten Einstieg (Abschnitt 3).

## Belegt am 02.08.2026

- **Takt:** GitHub-Workflow grün, `lastTrigger: "cron"`.
- **Zustellung:** Der zweite AgentMail-Schlüssel greift (`am_us_in…`). Testversand
  `HTTP 200` mit Message-ID über Amazon SES.
- **Produktion kennt den Schlüssel:** Der Benachrichtigungs-Block liefert
  `"health":"ok"` — den vergibt `healthFrom` **nur bei `hasMailConfig: true`**
  (`lib/notify/status.ts:39`). Geprüft mit dem Sandbox-Konto, nicht mit echten Trades.
- **Wecker nachgerüstet:** `alertsOpen` von 26 auf **44** gestiegen — 18 Einstiegs-Wecker
  für bereits geplante Trades.

> **Fallstrick beim ersten Schlüssel:** Er wurde mit `403 {"message":"Forbidden"}`
> abgewiesen — erkennbar **nicht** als App-Fehler, weil dieselbe Route ohne Schlüssel
> `401` liefert und ein falscher Pfad einen ausführlichen 404 mit `name`/`code`/`fix`.
> Der nackte 403 kam vom Gateway vor der API. Ein neuer Schlüssel löste es.

> **Redeploys sieht man bei GitHub nicht als neues Deployment**, sondern als neuen
> **Status** unter demselben Deployment (gleicher Commit). Wer nur die Deployment-Liste
> ansieht, hält einen erfolgten Redeploy fälschlich für ausgeblieben.

---

## Frühere Zwischenstände (02.08.2026)

- **Der Takt ist scharf.** GitHub-Secrets `APP_URL` und `CRON_SECRET` gesetzt, der
  Workflow `check-alerts.yml` ist grün. Beleg (Lauf 16:16 Uhr, HTTP 200):
  `{"ok":true,"alertsOpen":26,"triggered":0,"mailsSent":0,"mailsFailed":0}`
  Die roten Läufe von heute früh sind damit beendet.
- **`CRON_SECRET` stimmt überein** in `.env.local`, bei Vercel und bei GitHub.
- **Neu deployt**, die AgentMail-Werte sind in der Produktion angekommen.
- **Dev-Server läuft** wieder auf `http://localhost:3000`.

### Zwei Fallen, die dabei Zeit gekostet haben

- **Die Produktionsdomain ist nicht die naheliegende.** Richtig ist
  `https://stock-hit-rate-tracker-astra-quest.vercel.app` (Team `astra-quest`).
  `https://stock-hit-rate-tracker.vercel.app` gehört einem **fremden** Projekt und
  liefert überall 404 — auch auf der Startseite. Ein 404 auf einer API-Route sieht
  dabei aus wie „Deployment kaputt", obwohl nur die Adresse falsch ist.
- **`curl` taugt in PowerShell 5.1 nicht.** Dort ist es ein Alias für
  `Invoke-WebRequest` und kennt `-H` nicht; `$env:CRON_SECRET` ist zudem leer, weil
  der Wert in `.env.local` steht und nicht in der Umgebung. Entweder `curl.exe`
  ausdrücklich aufrufen oder:
  ```powershell
  $secret = (((Get-Content .env.local) | Where-Object { $_ -match '^\s*CRON_SECRET=' }) -replace '^\s*CRON_SECRET=','').Trim()
  Invoke-WebRequest -Uri "https://stock-hit-rate-tracker-astra-quest.vercel.app/api/cron/check-alerts" `
    -Headers @{ Authorization = "Bearer $secret" } -UseBasicParsing | Select-Object -ExpandProperty Content
  ```

---

## 1 · ERLEDIGT — der erste AgentMail-Schlüssel wurde abgewiesen

Die Werte stehen in `.env.local` und bei Vercel, aber die API lehnt den Schlüssel ab:

```
GET  /v0/inboxes                 → 403 {"message":"Forbidden"}
GET  /v0/inboxes/<inbox>         → 403 {"message":"Forbidden"}
POST /v0/inboxes/<inbox>/messages/send → 403 {"message":"Forbidden"}
```

**Das ist kein Fehler der App.** Nachgewiesen:
- **Ohne** Schlüssel antwortet dieselbe Route `401`, **mit** Schlüssel `403` — er wird
  also erkannt und trotzdem abgewiesen (nicht „unbekannt", sondern „nicht erlaubt").
- Die Version stimmt: Ein falscher Pfad liefert einen ausführlichen 404 mit
  `name`/`code`/`fix`. Der 403 hat eine **andere Form** (nacktes `{"message":"Forbidden"}`)
  und kommt damit vom Gateway **vor** der API.
- Format unauffällig: `am_us_…`, 63 Zeichen, reines ASCII, keine Anführungszeichen.
  Inbox-ID `simon-braendle@agentmail.to`.

- [ ] Im AgentMail-Dashboard nachsehen: Ist der Schlüssel **aktiv**, gilt er für **diese**
      Inbox, und hat er Schreibrechte? Im Zweifel einen **neuen Schlüssel erzeugen**.
- [ ] Neuen Wert in `.env.local` **und** bei Vercel eintragen → **Redeploy**.
- [ ] Danach sagen — der Testversand ist ein Aufruf, ich prüfe es sofort nach.

> Solange das offen ist, prüft der Takt zwar zuverlässig und die Alerts erscheinen in der
> App, aber es geht **keine Mail** raus. Verloren geht dabei nichts: `notifiedAt` wird nur
> nach erfolgreichem Versand gesetzt, ein späterer Lauf holt die Meldung nach.

## 2 · ERLEDIGT — Altbestand: „Wecker nachrüsten"

- [x] Cockpit → Alert-Block → **„Wecker nachrüsten"** geklickt (26 → 44 Wecker).

Die 26 offenen Alerts sind Stop- und Ziel-Marken. Deine bereits geplanten Trades haben
noch **keinen Einstiegs-Wecker** — den gibt es erst für ab jetzt angelegte Trades.
Diesen Klick mache bewusst **du**: Er fasst deine echten Trades an.

## 3 · Der letzte Nachweis — am ersten echten Einstieg

- [x] Einstellungen → Block **Benachrichtigung**: zeigt „Letzter Prüflauf vor X Minuten ·
      Meldungen gehen an …", nicht die Warnung über fehlende Zugangsdaten.
- [ ] Einen geplanten Trade mit Einstieg **knapp am aktuellen Kurs** anlegen → Mail muss
      ankommen, der Link muss in die Einstiegs-Ansicht führen.
      *Ungetestet bleibt bisher nur diese eine Stelle: Der Versand aus einem echten
      Auslöser heraus. Alle Teile davor sind einzeln belegt.*
- [ ] Zweiter Lauf danach: Es darf **keine zweite Mail** kommen.

---

## ERLEDIGT — Zeichnen im freien Replay (04.08.2026)

Im freien Replay (`/trainer/frei`) fehlte die Werkzeugleiste vollständig, weil
`drawingsEnabled` ein Instrument oder eine Übung verlangte — ohne Ziel zum Speichern gab
es keine Werkzeuge. Zeichnen IST aber die Analyse; ohne sie war das Replay nur ein Film.

Gelöst über `ephemeralDrawings` am `PriceChart`: Die Werkzeuge sind da, die Zeichnungen
leben **nur in der Ansicht** (negative IDs, keine Server-Aktion) und verschwinden beim
Verlassen. Das passt zum Versprechen der Seite — „keine Bewertung und keine Speicherung" —
und kostete keine Migration. Der Hinweis darauf steht unter dem Chart.

## Bewusst offen gelassen

- **Risiko in R** in der Einstiegs-Ansicht: Der Plan sah „Geld und R" vor, gebaut ist nur
  Geld. Das geplante Risiko ist definitionsgemäß immer 1,00 R — die Zeile wäre inhaltsleer.
- **Web-Push/PWA, Telegram, Ruhezeiten, Nachfassen bei verpasstem Einstieg** — ausgeschlossener
  Scope aus dem Drill. Die serverseitige Prüfung, die Web-Push bräuchte, steht bereits.

## Die nächste Etappe

Bewusst **noch nicht** festgelegt: erst einrichten, ein paar Tage damit handeln, dann aus
echter Reibung ableiten, was fehlt. Der Broker-CSV-Import ist **vom Tisch** (kein Broker
mit CSV-Export im Einsatz), obwohl `IDEEN-BACKLOG.md` ihn als größten Zeitgewinn führt.
