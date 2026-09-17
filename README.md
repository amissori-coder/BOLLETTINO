# Gestionale Bollettino — Collegio del Lazio

Gestionale per le pratiche delle logge del Collegio del Lazio (Grande Oriente
d'Italia): anagrafica delle pratiche con stato del flusso a semaforo, vista per
loggia, log delle attività, generazione di report PDF ed export Excel.

| | |
|---|---|
| App in produzione | <https://gestionale-collegio-lazio.web.app/> |
| Database | Firestore, progetto `gestionale-collegio-lazio` |

## Com'è fatta

Un unico file: [`public/index.html`](public/index.html). CSS in un blocco
`<style>`, logica in un blocco `<script>` finale. **Nessun build step**: il
file versionato è esattamente il file servito. Le dipendenze arrivano da CDN —
Firebase SDK *compat* 10.13.0 (Auth + Firestore), jsPDF con autotable per i
PDF, SheetJS per l'export Excel.

## Provarla in locale

```bash
python3 -m http.server -d public 8080
```

Poi apri <http://localhost:8080>. Serve un'origine HTTP: da `file://`
l'autenticazione Firebase non funziona.

## Pubblicarla

Da una macchina con la CLI di Firebase installata:

```bash
firebase deploy --only hosting
```

## Il database non si tocca

Il Firestore in produzione contiene i dati reali e non esiste un backup.
`firebase.json` dichiara **solo** la sezione `hosting`: senza le sezioni
`firestore` / `database` / `storage` nessun comando di deploy è in grado di
sovrascrivere dati o security rules. Non aggiungerle. Le regole di sicurezza
si gestiscono dalla console Firebase.

## Recupero del sorgente

Il codice non era mai stato versionato e la copia locale era andata perduta:
è stato recuperato dal deploy su Firebase Hosting. La procedura, lo strumento
(`tools/recover-from-hosting.mjs`) e le verifiche fatte sono documentate in
[`docs/RECOVERY.md`](docs/RECOVERY.md).
