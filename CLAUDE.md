# BOLLETTINO — Gestionale Bollettino, Collegio del Lazio

Gestionale per le pratiche delle logge del Collegio del Lazio (Grande Oriente
d'Italia): anagrafica pratiche, stato del flusso a semaforo, vista per loggia,
log attività, generazione di report PDF ed export Excel.

In produzione su Firebase Hosting: <https://gestionale-collegio-lazio.web.app/>
(progetto Firebase: `gestionale-collegio-lazio`).

## Architettura: una sola pagina, nessun build step

Tutta l'applicazione è **un unico file**, `public/index.html`: CSS in un blocco
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
- Per provare l'app in locale basta un server statico sulla cartella `public/`
  (per esempio `python3 -m http.server -d public 8080`): serve l'origine HTTP
  perché Firebase Auth non funziona da `file://`.
- Il logo va servito come `logo-goi.png` **accanto** a `index.html`: il codice
  lo carica al boot e lo converte in base64 per inserirlo nei PDF.

### Indice delle sezioni di `public/index.html`

Il codice è diviso da commenti a barra (`/* ===== */`). Nell'ordine:
costanti e dati seed · icone SVG · utilità · inizializzazione Firebase e
wrapper Firestore · autenticazione · presence (utenti connessi e soft-lock) ·
UI helper (sidebar mobile, ricerca globale, spinner) · stato e routing ·
modale · calcolo dello stato del flusso (semaforo) · pagina Database · form
pratica · dashboard · log attività · vista per loggia · pagina Logge · dati
fissi report · genera report · generazione PDF · init del flusso di auth.

### Collezioni Firestore

`pratiche` · `logge` · `users` · `datiFissi` · `logs` · `presence` · `_meta`

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
  `public/index.html` esiste una sezione "COSTANTI E DATI SEED" — non
  ricaricare quei seed su produzione.

## Recupero del sorgente (fatto)

Il sorgente non era mai stato versionato e la copia locale era andata perduta:
l'unica copia era quella deployata su Hosting. È stata recuperata con
`tools/recover-from-hosting.mjs` (vedi `docs/RECOVERY.md`). Il codice non era
minificato, quindi il recupero è integrale: commenti in italiano, nomi
originali, formattazione. `public/index.html` è il file deployato, byte per
byte.

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
