# Recupero della web app da Firebase Hosting

Il codice sorgente è andato perso in locale e non era mai stato messo su Git.
L'unica copia esistente sono i file **già deployati** su Firebase Hosting:

    https://gestionale-collegio-lazio.web.app/

Quei file sono pubblici, quindi recuperabili. Se il build è stato fatto con i
*source map* (`.js.map`), dentro i map c'è `sourcesContent`: cioè il **codice
sorgente originale**, file per file, non minificato. In quel caso il recupero è
quasi integrale. Altrimenti si recupera l'app funzionante in forma buildata e i
sorgenti si ricostruiscono leggendo il bundle.

## Lo strumento

`tools/recover-from-hosting.mjs` (Node >= 18, nessuna dipendenza):

```bash
node tools/recover-from-hosting.mjs https://gestionale-collegio-lazio.web.app recovered
```

Cosa fa:

1. scarica `index.html` e segue ricorsivamente ogni riferimento **same-origin**
   trovato in HTML, CSS, JS, JSON e manifest (compresi i chunk lazy-loaded che
   compaiono solo dentro il JS);
2. per ogni file scarica anche il suo `sourceMappingURL`;
3. riconosce il *rewrite SPA* di Firebase Hosting (che risponde `index.html` a
   qualsiasi rotta inesistente) e non salva i falsi positivi;
4. espande tutti i `.map` ricostruendo l'albero dei sorgenti originali,
   normalizzando i prefissi dei bundler (`webpack://`, `vite:///`, …) e
   isolando le dipendenze sotto `_deps/`.

Output:

| cartella | contenuto |
|---|---|
| `recovered/dist/` | i file deployati, byte per byte: l'app funzionante |
| `recovered/src/`  | i sorgenti originali estratti dai source map |

Dietro un proxy (es. una sessione Claude Code) serve Node >= 22.21 e
`NODE_USE_ENV_PROXY=1` davanti al comando.

## Esito del recupero (completato)

Il dominio `gestionale-collegio-lazio.web.app` era inizialmente negato dalla
policy di rete dell'ambiente; una volta consentito, lo script ha scaricato
l'intero sito in un passaggio:

| | |
|---|---|
| File scaricati | 2 — `index.html` (269 KB) e `logo-goi.png` (64 KB) |
| Source map | nessuno, e non servivano |
| Esito | **recupero integrale** |

Non c'erano source map perché **non c'era nessun build**: l'app è un singolo
file HTML scritto a mano, con CSS e JavaScript inline e le dipendenze da CDN.
Il file servito era già il sorgente, non minificato, con i commenti originali
in italiano. Verifiche eseguite sul file recuperato:

- tag bilanciati e nessun errore di parsing HTML;
- le 4.829 righe di JavaScript inline passano `node --check`.

Il risultato è stato messo in `index.html` e `logo-goi.png` nella radice del
repository, che è anche ciò che GitHub Pages pubblica. La cartella
`recovered/` prodotta dallo script non è versionata.

### Ri-sincronizzare in futuro

Se qualcuno pubblicasse una modifica senza passare da Git, il delta si
recupera rieseguendo lo script e confrontando:

```bash
node tools/recover-from-hosting.mjs https://gestionale-collegio-lazio.web.app recovered
diff -u index.html recovered/dist/index.html
```

Lo stesso confronto è disponibile come workflow manuale
(*Actions → Confronta con il deploy su Hosting*), utile per accorgersi della
divergenza senza avere l'ambiente sotto mano.

## Se il download è bloccato dalla rete

Il dominio deve essere consentito dalla policy di rete dell'ambiente
(`connect_rejected — organization policy` significa che non lo è). Tre strade:

1. **Allargare la policy di rete dell'ambiente** (la via usata): su
   claude.ai/code, icona nuvola sopra la casella del messaggio → sezione
   **Cloud** → ingranaggio sull'ambiente → **Network access: Custom** →
   aggiungere `gestionale-collegio-lazio.web.app` in **Allowed domains**,
   lasciando spuntato *Also include default list of common package managers*.
   Vedi <https://code.claude.com/docs/en/cloud-environments#network-access>.
2. **Eseguirlo in locale** su una macchina qualsiasi con Node, poi committare
   la cartella `recovered/`.
3. **Eseguirlo su un runner GitHub**: il workflow
   `.github/workflows/recover-hosting.yml` scarica il sito da un runner (che
   ha rete aperta) e lo confronta con l'`index.html` versionata. Parte solo a mano
   (*Actions → Confronta con il deploy su Hosting → Run workflow*), non usa
   segreti e non tocca il database. Se il deploy diverge dal codice
   versionato, mostra il diff nel riepilogo e allega la copia deployata come
   artifact scaricabile.

## Configurazione Firebase in questo repository

`firebase.json` dichiara **solo** `hosting`. È deliberato: senza le sezioni
`firestore` / `database` / `storage`, la CLI di Firebase non ha modo di
deployare regole o toccare i dati, quindi nessun comando di deploy può
danneggiare il database di produzione (di cui non esiste backup). Il deploy si
fa con:

```bash
firebase deploy --only hosting
```

`"public": "."` con la lista `ignore` che esclude documentazione e strumenti:
l'app sta nella radice del repository e non c'è build step, quindi il file
versionato è il file servito.

## Cosa usa l'app

Dalla config trovata in `index.html`: progetto
`gestionale-collegio-lazio`, **Firebase Auth** e **Firestore** via SDK
*compat* 10.13.0. Nessun uso di Realtime Database. Lo `storageBucket` è
dichiarato nella config ma non risultano chiamate a Firebase Storage.
Collezioni Firestore: `pratiche`, `logge`, `users`, `datiFissi`, `logs`,
`presence`, `_meta`.
