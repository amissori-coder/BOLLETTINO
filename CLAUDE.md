# BOLLETTINO — gestionale collegio Lazio

## Contesto (leggere prima di tutto)

Questa web app esisteva **solo** deployata su Firebase Hosting:

    https://gestionale-collegio-lazio.web.app/     (progetto: gestionale-collegio-lazio)

Il sorgente non era mai stato versionato e la copia locale è andata perduta.
Obiettivo: **ricostruire il repository dai file deployati** e da qui in avanti
sviluppare su GitHub. Su Firebase si mantiene **solo il database (Firestore)**.

## Regola inderogabile: il database non si tocca

Il database Firestore in produzione contiene i dati reali e **non esiste un
backup**. Quindi:

- `firebase.json` dichiara **solo** la sezione `hosting`. Nessuna sezione
  `firestore`, `database` o `storage`: senza quelle sezioni `firebase deploy`
  non è in grado di sovrascrivere dati o regole di sicurezza.
- Non aggiungere quelle sezioni. Non creare `firestore.rules` o
  `firestore.indexes.json` e non collegarli a `firebase.json`.
- Per deployare usare sempre e comunque: `firebase deploy --only hosting`.
- Nessuno script di migrazione, seed, import o cancellazione sui dati di
  produzione senza una richiesta esplicita dell'utente.

## Stato del lavoro

- [x] Strumento di recupero scritto e testato: `tools/recover-from-hosting.mjs`
- [x] Config Firebase hosting-only: `firebase.json`, `.firebaserc`
- [ ] **Scaricare i file deployati** (bloccato: vedi sotto)
- [ ] Estrarre la config Firebase dal bundle e capire quali servizi usa l'app
- [ ] Ricostruire `package.json` e la toolchain di build
- [ ] Verificare che il build locale produca un output equivalente al deployato

### Il passo bloccato

Il dominio `gestionale-collegio-lazio.web.app` è negato dalla policy di rete
dell'ambiente (`connect_rejected — organization policy`). Appena la policy
consente quell'host, il recupero è un comando:

```bash
NODE_USE_ENV_PROXY=1 node tools/recover-from-hosting.mjs \
  https://gestionale-collegio-lazio.web.app recovered
```

Verificare prima che l'host passi:

```bash
curl -sS -o /dev/null -m 20 -w "%{http_code}\n" https://gestionale-collegio-lazio.web.app/
```

`000` = ancora bloccato (ricontrollare la policy dell'ambiente). Vedi
`docs/RECOVERY.md` per le tre strade alternative.

Dopo il download, `recovered/dist/` contiene l'app deployata e
`recovered/src/` i sorgenti originali se il build includeva i source map.

## Convenzioni

- Sviluppo sul branch `claude/nifty-meitner-wcnh4p`.
- Commenti, documentazione e messaggi di commit in italiano.
- Le chiavi di configurazione Firebase lato client (`apiKey`, `projectId`, …)
  non sono segreti: stanno nel bundle pubblico. Vanno comunque in variabili
  d'ambiente di build, non hardcodate, e la protezione dei dati resta
  affidata alle security rules di Firestore.
