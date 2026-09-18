# BOLLETTINO — Gestionale Bollettino, Collegio del Lazio

Gestionale per le pratiche delle logge del Collegio del Lazio (Grande Oriente
d'Italia): anagrafica pratiche, stato del flusso a semaforo, vista per loggia,
log attività, generazione di report PDF ed export Excel.

In produzione su GitHub Pages: <https://amissori-coder.github.io/BOLLETTINO/>
Di Firebase si usa **solo** il database (Firestore) e l'autenticazione,
progetto `gestionale-collegio-lazio`.

## Architettura: una sola pagina, nessun build step

Tutta l'applicazione è **un unico file**, `index.html`, nella radice del
repository: CSS in un blocco
`<style>`, logica in un blocco `<script>` finale (~4.800 righe, 128 funzioni).
Non esiste toolchain, non c'è `package.json`, non c'è niente da compilare: il
file che sta nel repository è esattamente il file che viene servito.

Le dipendenze arrivano da CDN, caricate in `<head>`:

| Libreria | Versione | A cosa serve |
|---|---|---|
| Firebase App / Auth / Firestore (SDK **compat**) | 10.13.0 | autenticazione e database |
| jsPDF + jspdf-autotable | 2.5.1 / 3.8.2 | generazione dei PDF (report, solleciti) |
| SheetJS (xlsx) | 0.20.0 | export Excel |

Conseguenze pratiche da tenere a mente:

- Si usa l'SDK **compat** (`firebase.firestore()`, `firebase.auth()`), non
  l'SDK modulare v9+. Non mescolare le due sintassi.
- Lo script non è un modulo ES: niente `import`/`export`, le funzioni stanno
  nello scope globale e l'HTML le richiama inline.
- Per provare l'app in locale basta un server statico sulla radice del
  repository (`python3 -m http.server 8080`): serve l'origine HTTP perché
  Firebase Auth non funziona da `file://`.
- Il logo va servito come `logo-goi.png` **accanto** a `index.html`: il codice
  lo carica al boot e lo converte in base64 per inserirlo nei PDF.

### Indice delle sezioni di `index.html`

Il codice è diviso da commenti a barra (`/* ===== */`). Nell'ordine:
costanti e dati seed · icone SVG · utilità · inizializzazione Firebase e
wrapper Firestore · autenticazione · presence (utenti connessi e soft-lock) ·
UI helper (sidebar mobile, ricerca globale, spinner) · stato e routing ·
modale · calcolo dello stato del flusso (semaforo) · pagina Database · form
pratica · dashboard · log attività · vista per loggia · pagina Logge · dati
fissi report · genera report · generazione PDF · init del flusso di auth.

### Collezioni Firestore

`pratiche` · `logge` · `users` · `datiFissi` · `logs` · `presence` · `_meta`

In `datiFissi` ogni documento è una coppia `key`/`value`. Oltre agli elenchi
delle cariche ci sono tre chiavi di configurazione: `intestazione` e
`intestazioneColore` (il banner che apre la sezione delle cariche) e
`sezioniReport`, che tiene **ordine di stampa, titolo e colori** di ogni tabella
istituzionale del PDF. Le colonne restano invece nel codice, in
`COLONNE_SEZIONI_REPORT`: `getSezioniReport()` fonde la configurazione salvata
con il seed, così una sezione aggiunta in un aggiornamento compare in coda anche
su un database già popolato. L'utente modifica tutto dalla tab
*Dati Fissi Report → Ordine e Colori*.

### Storico delle cariche

Le cariche cambiano nel tempo e un bollettino di mesi passati deve ristampare i
nomi in carica allora. Ogni versione di una sezione è un documento della stessa
collection `datiFissi` con chiave **`storico:<sezione>:<AAAA-MM>`**, dove
`AAAA-MM` è la *decorrenza*: quella versione vale da quel mese finché non ne
comincia un'altra. È una funzione a gradini: nessun campo "valido fino a",
quindi non esistono né buchi né sovrapposizioni. La decorrenza convenzionale
`0000-01` (`DECORRENZA_INIZIALE`) è il dato che valeva prima della prima
modifica registrata, fotografato automaticamente la prima volta che una sezione
viene storicizzata. Storicizzate sono le nove sezioni elencate in
`SEZIONI_STORICIZZATE`; `intestazione`, `firmeBollettino`, `sezioniReport` e
`intestazioneColore` restano configurazione, non dati che cambiano di mese in
mese.

Regole da non violare toccando questa parte:

- il documento **a chiave semplice** rispecchia la versione più recente, così
  tutto ciò che legge `state.datiFissi[sezione]` continua a vedere il dato di
  oggi; non è il dato iniziale e non va usato come tale;
- `indicizzaDatiFissi()` è l'**unico** punto che divide chiavi correnti e chiavi
  storiche, ed è chiamato sia da `loadAllData()` sia dal listener real-time: due
  indicizzazioni separate possono divergere e far salvare sulla versione
  sbagliata;
- `salvaSezioneStorica()` è l'**unica** scrittura ammessa su queste sezioni.
  Nessun `dbPut("datiFissi", { key: <sezione> })` sparso: una modifica di oggi
  sovrascriverebbe il dato che serve a ristampare i mesi passati, e non c'è
  backup da cui recuperarlo;
- le modifiche nella pagina restano in `state.datiFissiBozza` e si scrivono solo
  premendo *Salva modifiche…*, che chiede mese e anno di decorrenza. Il
  salvataggio automatico a ogni tasto non può convivere con una decorrenza da
  indicare;
- "database vuoto" si decide con `datiFissiPresenti()`, che guarda le chiavi
  note del seed. Contare le chiavi di `state.datiFissi` è sbagliato: lo storico
  ne aggiunge di proprie e un conteggio sbagliato fa **riscrivere il seed sui
  dati reali**. Per lo stesso motivo nessun percorso di sola navigazione deve
  scrivere su Firestore: il seed si carica solo da un pulsante esplicito;
- `salvaSezioneStorica()` **rifiuta** una decorrenza già registrata se non le si
  passa `{ sostituisci: true }`. La scrittura su Firestore è un `set()` pieno:
  senza quella guardia, scegliere per distrazione un mese che esiste già
  cancella la versione che quei bollettini ristampano;
- la sentinella `0000-01` non è un mese e **non deve mai finire in una tendina**:
  l'anno 0 non compare fra le opzioni, il browser mostrerebbe il primo anno
  dell'elenco e si salverebbe un mese diverso da quello letto a video. Per lo
  stesso motivo `selectPeriodo()` aggiunge sempre alle opzioni l'anno del valore
  che riceve;
- la bozza ricorda **il mese su cui è nata** (`{ periodo, righe }`): il mese di
  riferimento è unico per la pagina e salvare un'altra sezione potrebbe
  spostarlo, facendo finire la bozza nel mese sbagliato.

I periodi sono sempre stringhe `AAAA-MM` con il mese a due cifre, perché il
confronto fra decorrenze è un confronto fra stringhe. I giorni del mese si
contano con l'aritmetica (`giorniNelMese`), mai costruendo `Date`: vedi il
commento su `isoDate` e il bug di fuso orario di `toISOString`.

In *Genera Bollettino* il periodo è una coppia mese+anno "Dal"/"Al" (uguali per
un bollettino di un mese solo) e vive in `state.reportPeriodo`, non nel DOM:
i listener real-time ridisegnano la pagina a ogni salvataggio e azzererebbero le
tendine. Le cariche stampate sono quelle in vigore nel mese **finale** del
periodo, cioè quelle in carica quando il bollettino esce.

Le pagine si ridisegnano riscrivendo l'intero `innerHTML`, e i listener
real-time di Firestore fanno scattare un ridisegno a ogni salvataggio: per non
far perdere il fuoco a chi sta scrivendo, `rerenderCurrent()` rimanda il
ridisegno finché un campo di testo è attivo e `conservaFocus()` ripristina fuoco
e cursore quando il ridisegno avviene comunque. Chi aggiunge campi editabili
inline dovrebbe dar loro un `id` stabile, altrimenti il fuoco non è
recuperabile.

## Hosting e deploy

L'app è servita da **GitHub Pages**, non più da Firebase Hosting.

`index.html` sta nella **radice** del repository, ed è deliberato: è la stessa
cartella che Pages pubblica quando è configurato in modalità *Deploy from a
branch*. Così il sito funziona con entrambe le impostazioni di *Settings →
Pages → Source*:

- **GitHub Actions**: pubblica `.github/workflows/pages.yml`, che carica la
  radice del repository;
- **Deploy from a branch** (`main` / root): pubblica la build automatica di
  Jekyll, che serve comunque la stessa `index.html`.

Il file `.nojekyll` nella radice è ciò che rende vera la seconda riga: senza
di esso Jekyll rielabora il contenuto e serve il README al posto dell'app.
**Non rimuoverlo.**

Il deploy è automatico: ogni push su `main` che tocca `index.html`,
`logo-goi.png` o `.nojekyll` pubblica. Nessun comando da lanciare, nessuna
CLI di Firebase.

Due proprietà dell'app che rendono possibile il sottopercorso `/BOLLETTINO/`
di Pages, e che vanno preservate nelle modifiche future:

- **tutti i percorsi sono relativi** (`logo-goi.png`, non `/logo-goi.png`).
  Non introdurre percorsi assoluti: si romperebbero sotto il sottopercorso;
- **non c'è routing basato sull'URL** (niente `location.pathname`,
  `history.pushState`): la navigazione è tutta in memoria.

Il login usa solo `signInWithEmailAndPassword`. La lista *Authorized domains*
di Firebase Auth vincola solo i flussi popup/redirect OAuth, quindi il
cambio di dominio non ha richiesto interventi sulla console. Se in futuro si
aggiungesse un login Google o simile, il dominio di Pages va aggiunto lì.

### Firebase Hosting: solo un redirect

`firebase.json` non pubblica più l'app: serve **solo un redirect 302** verso
l'indirizzo di Pages, così i vecchi link `*.web.app` continuano a funzionare.
La cartella `firebase-hosting-redirect/` deve restare **vuota**: in Firebase
Hosting i file statici hanno priorità sui redirect, quindi un `index.html`
lì dentro verrebbe servito al posto del redirect.

Il redirect è 302 (temporaneo) e non 301 di proposito: un 301 viene messo in
cache dai browser in modo aggressivo e renderebbe difficile tornare indietro.

Il redirect va online solo quando qualcuno esegue `firebase deploy --only
hosting` da una macchina con la CLI: dal repository non parte nulla verso
Firebase. Per ripubblicare l'app su Firebase Hosting, se servisse, si
ripristina la vecchia configurazione dalla storia di git.

**Mai eliminare il progetto Firebase**: cancellerebbe anche Firestore e
l'autenticazione. Hosting si spegne da solo, con `firebase hosting:disable`.

## Regola inderogabile: il database non si tocca

Il Firestore in produzione contiene i dati reali e **non esiste un backup**.

- `firebase.json` dichiara **solo** la sezione `hosting`. Nessuna sezione
  `firestore`, `database` o `storage`: senza quelle sezioni `firebase deploy`
  non è in grado di sovrascrivere dati o security rules.
- Non aggiungere quelle sezioni. Non creare `firestore.rules` o
  `firestore.indexes.json` e non collegarli a `firebase.json`.
- Per deployare usare sempre: `firebase deploy --only hosting`.
- Nessuno script di migrazione, seed, import o cancellazione sui dati di
  produzione senza una richiesta esplicita dell'utente. Attenzione: in
  `index.html` esiste una sezione "COSTANTI E DATI SEED" — non ricaricare
  quei seed su produzione.

## Recupero del sorgente (fatto)

Il sorgente non era mai stato versionato e la copia locale era andata perduta:
l'unica copia era quella deployata su Hosting. È stata recuperata con
`tools/recover-from-hosting.mjs` (vedi `docs/RECOVERY.md`). Il codice non era
minificato, quindi il recupero è integrale: commenti in italiano, nomi
originali, formattazione. `index.html` è il file deployato, byte per byte.

Lo script resta nel repository: è il modo di ri-sincronizzare dal deployato se
in futuro qualcuno pubblicasse una modifica senza passare da Git.

## Convenzioni

- Sviluppo sul branch `claude/nifty-meitner-wcnh4p`.
- Commenti, documentazione, UI e messaggi di commit in italiano.
- Lo stile del file esistente è la referenza: due spazi di indentazione,
  sezioni separate dai commenti a barra, funzioni con nomi in italiano.
  Aggiungere codice nella sezione pertinente, non in fondo al file.
- La chiave `apiKey` nella config Firebase **non è un segreto**: le config web
  di Firebase sono pubbliche per progetto ed era già visibile nell'HTML
  servito. La protezione dei dati dipende interamente dalle security rules di
  Firestore, che vanno gestite dalla console.
