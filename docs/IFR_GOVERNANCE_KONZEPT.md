# Gesamtkonzept: IFR Native Governance über Telegram

**Titel:** Integration eines Zwei-Kammern-Systems für transparente, skalierbare und token-gewichtete Community-Governance direkt in Telegram.  
**Projekt:** Inferno Protocol ($IFR)  
**Datum:** 08.03.2026  

---

## 1. Executive Summary

Ziel ist es, die IFR-Community direkt dort zu regieren, wo sie lebt: in Telegram. Es wird ein hybrides On-Chain/Off-Chain-Governance-System geschaffen, das die Burning-Charakteristik von IFR respektiert (keine Transaktionskosten für Voting) und gleichzeitig maximale Transparenz und Sicherheit bietet.

Das System besteht aus zwei separaten, aber sich ergänzenden Kammern:

1. **Der Rat (Team-Governance):** Für strategische Entscheidungen und Kapitalallokation.
2. **Das Forum (Community-Innovation):** Für kreative Vorschläge mit einem eingebauten, wirtschaftlichen Spamschutz.

---

## 2. Übergeordnete Architektur

Die Architektur ist dreigeteilt: Präsentation (Telegram), Logik (Backend/Bot) und Wahrheit (Blockchain).

```
[TELEGRAM - UI LAYER]
------------------------------------------------------
| Kanal @IFR_News      | Gruppe @IFR_Rat            |
| (Ankündigungen)      | (Nur Team + Bot)           |
------------------------------------------------------
| Gruppe @IFR_Forum     | Gruppe @IFR_Abstimmung    |
| (Jeder mit IFR-Lock)  | (Nur zur Stimmabgabe)     |
------------------------------------------------------
            |                           |
            | Bot liest/schreibt         | Bot triggert Transaktionen
            v                           v
[BACKEND - BOT LAYER (Node.js)]
------------------------------------------------------
| - Wallet-Verwaltung (Mapping User <-> Wallet)      |
| - Abfrage des IFR Lock Contracts (lesend)          |
| - Verwaltung von off-chain Votes (Reactions/Polls) |
| - Aggregation & Merkle-Tree-Erstellung             |
| - Ausführung von On-Chain-Transaktionen (nur Bot)  |
------------------------------------------------------
            |                           |
            | Liest Lock-Status          | Sendet Ergebnisse/Finalisierung
            v                           v
[BLOCKCHAIN - ON-CHAIN LAYER (Ethereum)]
------------------------------------------------------
| IFR CORE:                                          |
| - IFR Token Contract                               |
| - IFR Lock Contract <------------------------------+
|----------------------------------------------------|
| NEUE VERTRAEGE:                                    |
| - RatVoting.sol      (fuer Team-Abstimmungen)      |
| - ForumVoting.sol    (fuer Community-Vorschlaege)  |
| - IFRSpamProtection.sol (verwaltet die 10 IFR)     |
------------------------------------------------------
```

---

## 3. Die Zwei Kammern im Detail

### Kammer 1: Der Rat (Team-Governance)

- **Zweck:** Verwaltung von Protokoll-Parametern, Treasury-Mitteln und strategischen Partnerschaften.
- **Teilnehmer:** Das Dev-Team / Multi-Sig-Unterzeichner.
- **Vorschlagsrecht:** Ausschließlich das Team.

**Funktionsweise:**

1. **Initierung:** Ein Teammitglied erstellt einen Vorschlag via `/rat_proposal "Titel" "Beschreibung" "Dauer"`.
2. **Ausspielung:** Bot postet Vorschlag in @IFR_Rat (read-only für Community). Diskussion findet in @IFR_Forum statt.
3. **Abstimmung (Snapshot-Modell):** Nur Nutzer mit IFR-Lock dürfen teilnehmen. Stimmen off-chain, gewichtet nach Lock-Höhe (1 IFR = 1 Stimme).
4. **Abschluss & Verankerung:**
   - Bot aggregiert gewichtete Ergebnisse
   - Bot erstellt Merkle Tree aus allen abgegebenen Stimmen
   - Bot sendet einzige On-Chain-Transaktion an `RatVoting.sol`: ProposalID + ForWeight + AgainstWeight + MerkleRoot
   - Jeder Voter kann nachweisen, dass seine Stimme korrekt im Merkle Tree enthalten war

---

### Kammer 2: Das Forum (Community-Innovation)

- **Zweck:** Community bringt Ideen ein; populärste kommen zur finalen Abstimmung.
- **Teilnehmer:** Jeder Nutzer mit IFR-Lock.
- **Vorschlagsrecht:** Jeder — gegen eine Gebühr von **10 IFR** (Spamschutz).

**Funktionsweise:**

1. **Einreichung (Spamschutz):**
   - Member nutzt `/propose Meine Idee` in @IFR_Forum
   - Bot prüft IFR-Lock und überweist 10 IFR an `IFRSpamProtection.sol`
   - Bot postet die Idee als eigene Nachricht

2. **Up-/Down-Voting-Periode (7 Tage):**
   - Community votet per Reaction (👍 Up / 👎 Down)
   - Bot gewichtet jede Reaction mit dem IFR-Lock des Voters
   - Automatische Löschung: Downvote-Anteil > 50% des Gesamtgewichts → Idee scheitert, 10 IFR verbrannt

3. **Ranking & Konsensfindung:**
   - Täglicher Cron-Job berechnet Score (Up minus Down) aller aktiven Vorschläge
   - Top 3 Vorschläge werden täglich im Forum gepostet

4. **Konsensierung (Binding Vote):**
   - Vorschlag bleibt 10 Tage ununterbrochen in Top 3 → Konsensierungsphase
   - Bot erstellt EIP-712 konforme Nachricht
   - Berechtigte signieren via `/sign 42 yes`
   - Bot sammelt Signaturen über 3 Tage

5. **Finale Umsetzung:**
   - Bot bündelt Signaturen → einzige Transaktion an `ForumVoting.sol`
   - Contract prüft: Signatur valide? IFR-Lock zum Zeitpunkt ausreichend?
   - Ergebnis on-chain gespeichert, für immer gültig
   - Team nutzt on-chain Ergebnis als Weisung für nächste Schritte

---

## 4. Bot-Architektur ("Der Kleber")

Ein einziger Bot bedient beide Kammern mit strikter Rollentrennung.

**Kernkomponenten:**

| Komponente | Funktion |
|---|---|
| Wallet-Mapper | Verschlüsselte DB: TelegramUserID ↔ EthereumAddress (einmalige kostenlose Signatur) |
| IFR-Reader | Liest permanent IFR Lock Contract (Infura/Alchemy), cached Lock-Beträge |
| Reaction-Tracker | Trackt jede Reaction mit Zeitstempel + Lock-Gewicht des Users |
| Poll-Manager | Erstellt native Telegram-Umfragen für den Rat, aggregiert gewichtete Ergebnisse |
| Cron: Ranking-Calculator | Läuft täglich, berechnet Top-Vorschläge |
| Cron: Consensus-Starter | Prüft ob Vorschlag 10 Tage in Top 3 war |
| Cron: Finalizer | Schickt gesammelte Votes nach Signaturphase on-chain |
| Executor | Einzige Komponente mit Private Key / Multi-Sig Zugriff für On-Chain-Transaktionen |

---

## 5. Neu zu erstellende Smart Contracts

### RatVoting.sol
- Speichert Ergebnisse der Team-Abstimmungen (Snapshot-Modell)
- `finalizeProposal()` — nur vom Bot aufrufbar, speichert: ProposalID, ForWeight, AgainstWeight, MerkleRoot
- `verifyVote(proposalId, voterAddress, vote, weight, proof)` — View-Funktion, mit der jeder Voter seine Stimme nachweisen kann

### ForumVoting.sol
- Verwaltet bindende Community-Abstimmungen (Signed-Vote-Modell)
- `submitVotes(ProposalID, VoteMessage[] votes, bytes[] signatures)` — iteriert über alle Votes, prüft Signatur (ecrecover), fragt IFR Lock Contract ab, speichert Endergebnis

### IFRSpamProtection.sol
- Nimmt 10 IFR Gebühr für neue Vorschläge entgegen
- Bei erfolgreicher Konsensierung: 10 IFR zurückerstatten (Anreiz für gute Vorschläge)
- Bei Löschung (Downvote > 50%): 10 IFR verbrannt → deflationär
- Erfordert `approve()` vom User vor Einreichung

---

## 6. User Journey

**Neuer User "Max" entdeckt IFR:**

1. Max tritt @IFR_News bei und sieht Ankündigungen.
2. Er will mitreden → tritt @IFR_Forum bei.
3. Bot: *"Willkommen! Verbinde deine Wallet mit IFR-Lock. Sende /connect."*
4. Max sendet `/connect` → Bot schickt Mini-App Link → Max verbindet MetaMask, signiert kostenlos.
5. Bot: *"✅ Verbunden! Du hast 5.000 IFR gelockt. Du hast jetzt 5.000 Stimmen."*
6. Max sieht Team-Vorschlag in @IFR_Rat (read-only), diskutiert im Forum, stimmt via Poll ab. Seine Stimme zählt 5.000.
7. Max hat eine eigene Idee → `/propose "Treasury soll 10k IFR für Community-Event spenden"` → Bot zieht 10 IFR ein → Idee wird gepostet und erhält Upvotes.
8. Nach 10 Tagen in Top 3 → Bot per DM: *"Dein Vorschlag ist in der Konsensphase! Stimme ab: /sign 42 yes"*
9. Max signiert mit Wallet → Bot: *"Stimme registriert. Endergebnis in 3 Tagen on-chain unter tx: 0x..."*

---

## 7. Fazit & Wert für das IFR Core Team

| Eigenschaft | Beschreibung |
|---|---|
| Skalierbarkeit | Tausende Nutzer ohne hohe Gas-Kosten |
| Sicherheit | On-Chain-Verankerung verhindert Manipulation |
| Ökonomische Anreize | 10 IFR Spamschutz unterstützt Deflation von IFR |
| Transparenz | Alle Schritte in Telegram dokumentiert oder on-chain einsehbar |
| Professionalität | Klare Trennung Team-Governance / Community-Innovation |

Dieses System wäre eine weltweit einzigartige Integration von Telegram in ein deflationäres Asset und könnte als Blaupause für andere Communities dienen. Das Core-Team behält Admin-Kontrolle über alle sicherheitsrelevanten Prozesse.

---

*Stand: 08.03.2026 — IFR Governance Konzept v1.0*
