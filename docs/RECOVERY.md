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

## Come eseguirlo

Il dominio `*.web.app` è **bloccato dalla policy di rete** dell'ambiente remoto
di Claude Code, quindi il download non può partire da dentro la sessione così
com'è. Tre strade:

1. **Allargare la policy di rete dell'ambiente** (la via pulita): aggiungere
   `gestionale-collegio-lazio.web.app` agli host consentiti nelle impostazioni
   dell'ambiente, poi rieseguire lo script dalla sessione.
   Vedi <https://code.claude.com/docs/en/claude-code-on-the-web>.
2. **Eseguirlo in locale** su una macchina qualsiasi con Node, poi committare
   la cartella `recovered/`.
3. **Eseguirlo su un runner GitHub**: il workflow
   `.github/workflows/recover-hosting.yml` fa esattamente questo e committa il
   risultato sul branch di lavoro. Parte solo a mano
   (*Actions → Recupera app da Firebase Hosting → Run workflow*), non usa
   segreti e non tocca il database.

## Configurazione Firebase in questo repository

`firebase.json` dichiara **solo** `hosting`. È deliberato: senza le sezioni
`firestore` / `database` / `storage`, la CLI di Firebase non ha modo di
deployare regole o toccare i dati, quindi nessun comando di deploy può
danneggiare il database di produzione (di cui non esiste backup). Il deploy si
fa con:

```bash
firebase deploy --only hosting
```

`"public": "dist"` è il default di Vite: va allineato alla cartella di output
reale del build una volta ricostruita la toolchain (`build/` per Create React
App, `dist/` per Vite).

## Dopo il recupero

- ricavare la config Firebase dal bundle (`apiKey`, `projectId`, `authDomain`,
  …) per capire quali servizi usa l'app: Firestore, Realtime Database, Auth,
  Storage;
- ricostruire `package.json` e la toolchain di build dai sorgenti recuperati;
- aggiungere `firebase.json` e `.firebaserc` configurati **solo per
  l'Hosting**, così un `firebase deploy --only hosting` non tocca in alcun modo
  dati o regole del database.
