# Memo an das IFR-Team — PartnerVault, Seller-Rewards und nachhaltige Attraktivität

> **An:** Core Developer / Keyholder Council, IFR Protocol
> **Von:** externe Analyse (George / MG) auf Basis der öffentlichen Wiki, der Mainnet-Darstellung und der Tokenomics-Dokumente
> **Datum:** 15. September 2026
> **Betreff:** Das PartnerVault kann leer laufen – und die aktuelle Formel koppelt den Use-Case an eine Subvention, die sich selbst nicht trägt
> **Status:** Diskussionsvorlage, keine Anlageempfehlung
>
> *Provenienz: Eingereicht als Diskussionsdokument über Collateral Web3 Open Audits; wörtlich übernommen, lediglich Chat-Formatierung normalisiert. Begleitende technische Verifikation der Contract-Fakten siehe PR-Beschreibung.*

## 1. Zweck dieses Papiers

Wir sehen ein strukturelles Problem, kein bloßes Kommunikationsproblem.

Der Shop-Use-Case („Kunde lockt IFR, Seller gibt Rabatt") soll Partner gewinnen. Der Anreiz dafür soll aus dem PartnerVault kommen. Dieser Vault ist endlich. Nachgefüllt werden soll er vor allem aus Transfergebühren. Transfergebühren entstehen erst, wenn schon Nutzung und Handel da sind.

Daraus folgt eine gefährliche Schleife:

- Ohne Rewards kommen Partner nur schwer.
- Mit der heutigen Formel können Rewards den Vault leeren oder Lock-Farming auslösen.
- Ohne Volumen füllt sich der Vault nicht nach.
- Ist der Vault leer, fällt genau der Anreiz weg, den das Protokoll als Wachstumsmotor beschreibt.

Dieses Memo formuliert das Problem präzise und schlägt eine konkrete Alternative vor: Reward in Euro rechnen, in IFR zahlen, nur bei echter Kasseneinlösung, mit hartem Budget.

## 2. Ist-Zustand, so wie er öffentlich beschrieben ist

### 2.1 Der PartnerVault

- Adresse: `0xc6eb7714bCb035ebc2D4d9ba7B3762ef7B9d4F7D`
- Ausstattung: 40.000.000 IFR (4 % der Genesis-Supply)
- Zweck: lock-getriggerte Creator-/Builder-Rewards
- Auszahlung nicht aus dem Lock des Kunden, sondern aus diesem separaten Topf
- Seller-Rewards im Benefits Network sind derzeit deaktiviert, bis Governance den Builder registriert und ein authorized reward caller gesetzt ist

### 2.2 Die heutige Formel

```text
Reward_IFR = Lockbetrag × RewardBps / 10.000
```

- Contract-Grenzen: 5–25 % (500–2.500 bps)
- Policy-Ziel: 10–20 %
- Beispiel der Wiki: 1.000 IFR Lock bei 15 % → 150 IFR Reward
- Vesting: 6–12 Monate linear
- Jahresdeckel: Standard 4.000.000 IFR/Jahr (Contract erlaubt 1–10 Mio.)
- Zusätzlich individuelles Cap pro Builder

### 2.3 Geplante Nachfüllung

Laut Protocol Plan soll der BuybackController eingreifen, wenn der PartnerVault unter 85 % (34 Mio. IFR) fällt, und aus dem BuybackVault auf 90 % (36 Mio. IFR) auffüllen.

Das BuybackVault speist sich aus der 1-%-Poolgebühr auf Transfers. Split laut Doku: 70 % Operating Pool, 30 % SOS-Reserve.

Die Tokenomics-Seiten beschreiben denselben 40-Mio.-Topf an anderer Stelle eher als festen, verbrauchsartigen Bestand. Diese Unschärfe ist selbst ein Risiko: Das Team argumentiert intern möglicherweise mit „wird nachgefüllt", während Partner „40 Mio. sind da" lesen.

### 2.4 Markt- und Nutzungsrealität (September 2026)

- sehr wenige Holder (Größenordnung zwei Dutzend)
- Uniswap-Liquidität im Bereich von rund 1.000 USD
- zeitweise kein messbares 24h-Volumen
- Bootstrap nur 0,030 ETH
- FeeRouter zuletzt mit einem niedrigen sechsstelligen IFR-Betrag, nicht mit den Millionen, die ein Refill von 34 auf 36 Mio. bräuchte
- Lending und preisabhängige Mechaniken teilweise fail-closed / ohne robusten Preis

Die Architektur ist also für ein lebendiges Ökosystem geschrieben. Das Ökosystem ist noch nicht da. Genau in dieser Lücke wird die Formel gefährlich.

## 3. Das Problem, das wir sehen

### 3.1 Kernbefund

Der PartnerVault ist kein Perpetuum mobile.

Er ist ein Verbrauchstopf mit optionaler Nachfüllung. Die Nachfüllung hängt von genau der Aktivität ab, die die Rewards erst erzeugen sollen.

Das ist kein Randdetail. Es ist der zentrale Anreizmechanismus für Seller.

### 3.2 Problem A — Die Formel zahlt den Lock, nicht den Nutzen

Heute entsteht der Reward, wenn jemand IFR für ein Produkt lockt. Der wirtschaftliche Akt des Sellers ist aber der Rabatt bzw. der Zugang.

Folgen:

- Ein Lock ohne Kauf kann belohnt werden.
- Ein großer Lock bei Mini-Rabatt wird überbezahlt.
- Ein kleiner Lock bei echtem 10-€-Rabatt wird unterbezahlt.
- Farming ist attraktiv, sobald Reward-IFR mehr wert ist als der Aufwand fürs Locken.
- Der Protokollanreiz und der Kunden-Use-Case sind nur lose gekoppelt.

### 3.3 Problem B — Die Formel ist preisblind auf die falsche Weise

Die Auszahlung hängt nur an der IFR-Menge, nicht am Marktwert.

| Marktlage | Wirkung auf Seller | Wirkung auf Vault |
| --- | --- | --- |
| Preis sehr niedrig | Reward in Euro winzig, Anreiz tot — oder Lock-Farming, weil Locks fast gratis sind | IFR fließt ab, obwohl kaum echter Umsatz entsteht |
| Preis steigt | Reward in Euro wird plötzlich hoch | Dieselbe IFR-Formel wird für das Protokoll teuer |
| Preis schwankt stark | Partner können nicht kalkulieren | Budgetplanung unmöglich |

Eine bloße Umstellung auf „mal Marktpreis" ohne Deckel löst das nicht. Dann gilt die Gegenfalle:

- Preis fällt → Protokoll muss mehr IFR zahlen, um denselben Euro-Wert zu halten → Vault leert sich schneller.
- Preis steigt → Euro-Wert der alten Prozentformel explodiert.

Preis gehört in die Formel. Aber nur zusammen mit Euro-Deckeln und Nachweis einer Einlösung.

### 3.4 Problem C — Nachfüllung ist zirkulär

Gewünschter Kreis laut Doku:

Locks → Rewards → Vault sinkt → Gebühren füllen nach → Rewards bleiben möglich.

Tatsächlicher Kreis bei Mini-Markt:

wenig Handel → wenig 1-%-Gebühren → kein Refill → Rewards nur aus den 40 Mio. → wenn diese als Wachstumsköder aggressiv verteilt werden, ist der Köder irgendwann weg.

Der Jahresdeckel von 4 Mio. IFR streckt das auf grob zehn Jahre. Das ist eine Bremse, keine Tragfähigkeit. Zehn Jahre Emission ohne Einnahmen sind immer noch ein Verbrauch, kein Modell.

### 3.5 Problem D — Der Use-Case wird mit der Subvention verwechselt

Zwei Dinge werden in der Kommunikation vermischt:

1. Kunden-Use-Case: Lock prüfen, Rabatt/Zugang geben, Kunde behält IFR.
2. Seller-Subvention: PartnerVault zahlt IFR für Integration.

Der erste Use-Case braucht den Vault nicht. Der zweite braucht ihn.

Wenn Partner nur wegen (2) mitmachen, stirbt die Integration, sobald (2) leer oder unattraktiv ist.

Ein Protokoll, das sagt „ohne Rewards kein Use-Case", hat keinen Use-Case gebaut. Es hat eine Prämie gebaut.

### 3.6 Problem E — Operative Lücke vor der ökonomischen

Selbst die heutige Formel ist für Shop-Seller noch nicht live. Es fehlt Registrierung plus authorized caller. Das ist gut gegen Wildwuchs, heißt aber auch: Man sollte die Formel jetzt ändern, bevor der erste Reward on-chain festgezurrt wird. Nach dem ersten Partnerbestand wird jede Änderung politisch teurer.

## 4. Zielbild für eine Lösung

Eine gute Lösung muss gleichzeitig vier Dinge erfüllen:

1. Für Partner kalkulierbar bleiben — in Euro, nicht in abstrakten IFR-Prozentsätzen.
2. Den Vault nicht leer farmen lassen.
3. Nur echte wirtschaftliche Akte belohnen — eingelöster Rabatt, nicht bloßer Lock.
4. Mit Mini-Liquidität und fehlendem Oracle leben können — inklusive Pause, wenn kein belastbarer Preis da ist.

Nicht-Ziele:

- Den Tokenpreis stützen.
- Immer höhere Rewards versprechen.
- Noch einen Vault bauen, bevor Checkouts existieren.

## 5. Empfohlene Lösung

### „USD-Budget gegen nachweisbaren Checkout"

#### 5.1 Grundidee in einem Satz

Der Seller bekommt eine Euro-prämierte Beteiligung am tatsächlich gewährten Rabatt, ausgezahlt in IFR zum TWAP, nur nach einmaliger Kasseneinlösung, begrenzt durch Event-, Partner- und Tagesbudgets. Das Tagesbudget steigt und fällt mit echten Protokolleinnahmen.

#### 5.2 Auslöser

Reward entsteht nicht bei `lock()`.

Reward entsteht erst, wenn alle Bedingungen zusammen wahr sind:

1. Seller ist per Governance als Builder registriert.
2. Kunde hat den geforderten Lock (oder qualifizierten CommitmentVault-Status).
3. Kunde hat die konkrete Seller-Regel bestätigt.
4. Seller hat den Checkout einmal redeemed.
5. Warenwert und Cooldown sind erfüllt.
6. Ein belastbarer TWAP existiert. Sonst: kein Reward, Checkout darf trotzdem laufen.

Damit bleibt der Kunden-Use-Case auch dann lebendig, wenn Rewards pausieren.

#### 5.3 Formel

Zuerst der wirtschaftliche Wert:

```text
RewardUSD = min( R_D · D , R_L · L_USD , C_Event )
```

Dann die Auszahlung:

```text
RewardIFR = RewardUSD / TWAP_24h
```

Dabei:

- `D` = gewährter Rabatt in USD/EUR zum Checkout-Zeitpunkt
- `L_USD = Lockbetrag × TWAP_24h`
- `R_D` = Anteil am Rabatt
- `R_L` = Anteil am Lockwert
- `C_Event` = harte Obergrenze pro Einlösung

Zusätzliche Deckel:

```text
Summe_Tag(RewardUSD)          <= B_Tag
Summe_Partner_Monat(RewardUSD) <= C_Partner
```

Wenn ein Deckel greift, wird der Reward gekürzt oder auf die nächste Epoche verschoben. Er wird nicht „trotzdem in IFR" durchgedrückt.

#### 5.4 Empfohlene Startparameter

Für die aktuelle Marktgröße bewusst klein. Lieber später erhöhen als zuerst den Vault verbrennen.

| Parameter | Startwert | Begründung |
| --- | --- | --- |
| `R_D` | 20 % | Seller, der 10 € nachlässt, kann bis zu 2 € Prämie sehen |
| `R_L` | 5 % | verhindert Prämie auf ökonomisch leere Locks |
| `C_Event` | 3 € | reicht als spürbarer Köder, nicht als Arbitrage |
| `C_Partner_Monat` | 50 € | früh genug, um Tests zu fahren, zu klein zum Leersaugen |
| `B_Tag` | 20 € | ca. 600 €/Monat globale Subvention in der Bootstrap-Phase |
| Cooldown je Kunde/Seller | 24 Stunden | gegen Wiederholungsfarming |
| Mindestwarenwert | 5 € | gegen 0,10-€-Alibi-Käufe |
| TWAP | 24h Uniswap, mit Mindestliquidität | gegen Spot-Manipulation |
| Pause-Regel | kein Reward, wenn Pool unter Schwelle oder TWAP unfrisch | Safety first |

Zahlen sind Governance-Parameter, nicht Dogma. Wichtig ist die Struktur: Euro zuerst, IFR nur als Auszahlungsmittel.

#### 5.5 Rechenbeispiele

**Fall 1 — sinnvoller Sale**

Warenwert 40 €, Rabatt 8 €, Lockwert 2 €.

```text
min(0,20×8 , 0,05×2 , 3) = min(1,60 , 0,10 , 3) = 0,10 €
```

Hier greift der Lockwert-Deckel. Das ist gewollt: Wer fast nichts bindet, bekommt keine große Prämie.

Wenn das Team solche Fälle großzügiger behandeln will, kann `R_L` für geprüfte Partner auf 25 % des Lockwerts steigen, aber `C_Event` bleibt.

**Fall 2 — echter Rabatt, ausreichender Lock**

Warenwert 40 €, Rabatt 8 €, Lockwert 15 €.

```text
min(1,60 , 0,75 , 3) = 0,75 €
```

Oder, falls man `R_L` nur als Schutzdeckel und `R_D` als Leitgröße nutzt und die Formel auf `min(R_D·D, C_Event)` vereinfacht, solange `L_USD >= D`:

```text
min(1,60 , 3) = 1,60 €
```

Das ist die Variante, die Partner am ehesten verstehen: 20 % vom gewährten Rabatt, max. 3 €.

**Fall 3 — Farming-Versuch**

50 Locks à 5.000 IFR ohne Warenkorbeinlösung.

Reward: 0. Weil kein Redeem.

**Fall 4 — Preiscrash**

RewardUSD bleibt 1,60 €. Das Protokoll zahlt mehr IFR. Der Tagesdeckel `B_Tag` in Euro begrenzt den Schaden. Der Vault kann nicht durch einen Dump schlagartig in IFR ausbluten über das Euro-Budget hinaus.

**Fall 5 — Preisanstieg**

RewardUSD bleibt 1,60 €. Partner sieht denselben Euro-Anreiz. Das Protokoll gibt weniger IFR aus. Keine plötzliche Überbezahlung.

Genau das leistet die alte Prozent-vom-Lock-Formel nicht.

## 6. Wie der Vault diesmal nicht leerläuft

### 6.1 Drei Töpfe statt einer Hoffnung

**Topf 1 — Bootstrap (die heutigen 40 Mio. IFR)**

Nur für registrierte Partner, nur über die neue Formel, mit Euro-Budget. Nicht „15 % auf jeden Lock, bis der Topf alle ist".

**Topf 2 — Checkout-Fee (neue, ehrliche Einnahme)**

Pro erfolgreicher Einlösung zahlt der Seller eine kleine Gebühr, z. B. 0,20–0,50 € in IFR oder ETH.

Das ist der Preis für den Protokoll-Service „Lock prüfen + einmaligen Pass einlösen".

Dann gilt die Nachhaltigkeitsregel:

```text
B_Tag <= Checkout-Fees + Transferfees + manuell bewilligter Bootstrap
```

Liegen die Einnahmen sieben Tage unter dem Budget, sinkt `B_Tag` automatisch. Steigen sie vier Wochen stabil, darf Governance das Budget erhöhen.

**Topf 3 — Transfergebühr / BuybackVault**

Bleibt als Overflow erhalten. Wird aber nicht mehr als Lebensversicherung verkauft. Bei der heutigen Liquidität kann sie das nicht sein.

### 6.2 Was mit dem 85-%-Refill passiert

Den Mechanismus kann man behalten, aber umdeuten:

- Refill ist ein Glättungspuffer, kein Versprechen unendlicher Rewards.
- Refill nur, wenn BuybackVault tatsächlich IFR hat.
- Wenn nicht: Rewards drosseln, nicht „trotzdem buchen und später scheitern".
- On-chain muss `recordLockReward` bei Unterdeckung sauber revertieren oder 0 gutschreiben, nicht implizit Schulden erzeugen.

Das sollte im Contract und in der Wiki identisch stehen.

### 6.3 Bootstrap-Phase bewusst zeitlich begrenzen

Beispiel:

- Monate 1–6 nach Reward-Aktivierung: bis zu 20 €/Tag aus dem 40-Mio.-Topf, auch wenn Fees das noch nicht decken.
- Danach: nur noch so viel, wie Topf 2 + Topf 3 hergeben.
- Öffentlich kommunizieren. Partner wissen dann, dass die Anfangsprämie eine Starthilfe ist, kein ewiger Lohn.

Das hält Partner am Anfang attraktiv und verhindert die Illusion, 40 Mio. IFR seien ein Gehaltstopf für immer.

## 7. Attraktivität für Partner — ohne den Vault zu verbrennen

Euro-Prämien allein reichen bei 20 €/Tag global nicht für große Händler. Deshalb muss Attraktivität gestapelt werden.

### 7.1 Was Partner in Euro sehen sollen

- planbare Mini-Prämie: „20 % vom Rabatt, max. 3 €, max. 50 € im Monat"
- Auszahlung in IFR, Anzeige in Euro
- Vesting kürzer in der Bootstrap-Phase, z. B. 30–90 Tage statt 6–12 Monate, solange die Beträge klein sind

Lange Vesting-Zeiten bei 1,60 € Prämie wirken wie Verweigerung, nicht wie Alignment.

### 7.2 Was Partner ohne Tokenabfluss sehen sollen

Diese Hebel kosten den Vault nichts und sind für kleine Seller oft mehr wert:

- sichtbare Platzierung in shop.ifrunit.tech
- „Verified Builder"-Badge nach Governance-Registrierung
- niedrigerer Lock-Schwellenwert für den Kunden
- Gas-Zuschuss für die ersten 50 Checkouts
- fertiges Plugin / 5-Zeilen-SDK / WooCommerce- oder Shopify-Snippet
- gemeinsamer Launch-Post, sobald der erste echte Sale durch ist
- späteres Builder-Stimmrecht, aber erst wenn Checkouts existieren

### 7.3 Warum das ehrlicher ist als 15 % vom Lock

Bei einem Tokenpreis nahe null sind „150 IFR auf 1.000 IFR Lock" entweder wertlos oder farmbar.

Eine sichtbare 8-€-Ersparnis für den Kunden plus 1–2 € Protokollzuschuss plus Traffic ist ein Satz, den ein echter Händler versteht.

Wenn ein Partner nur wegen spekulativer IFR-Menge mitmacht, will man ihn in dieser Phase nicht als Leitpartner.

## 8. Missbrauchsregeln, ohne die jede Preisformel scheitert

1. Kein Reward auf Lock. Nur Redeem.
2. Ein Pass, ein Sale, ein Reward. QR nicht wiederverwendbar — das habt ihr schon; das muss an den Vault gebunden werden.
3. Cooldown je Pair Kunde/Seller.
4. Mindestwarenwert.
5. TWAP statt Last Price, mit Maximalabweichung zum Spot. Bei Bruch: Pause.
6. Mindestliquidität im IFR/WETH-Pool, sonst kein Reward. Ein manipuliertes 1.000-USD-Becken darf keine Euro-Prämien definieren.
7. Keine Selbstdeals. Seller-Wallet und Kunden-Wallet dürfen nicht identisch sein; Cluster-Heuristik wenigstens off-chain in v1.
8. Per-Builder-Cap bleibt. Auch ein großer Partner darf das Tagesbudget nicht allein leerziehen.
9. authorized caller eng halten. Nur das Checkout-Backend bzw. ein Allowlist-Contract darf Rewards anstoßen.
10. Öffentliches Dashboard: Vaultstand, heutiges Restbudget, Fees der letzten 7 Tage, Rewards der letzten 7 Tage.

Punkt 6 ist unbequem, aber notwendig. Ohne liquiden Preis gibt es keinen seriösen Euro-Reward. Dann lieber pausieren als so tun.

## 9. Alternativen — und warum sie schlechter passen

**A. Nur Marktpreis in die alte Formel mischen**

`RewardIFR = g(Lock × Preis)` ohne Euro-Tagesdeckel.

Ergebnis: entweder Vault-Run bei Dump oder Partnerflucht bei Dump. Ungeeignet.

**B. Fester IFR-Betrag pro Sale**

Einfach, aber preisabhängig ungerecht. Bei +10x zu teuer fürs Protokoll, bei −10x uninteressant für Partner.

**C. Reines Epoch-Mining**

Wöchentlicher IFR-Topf, verteilt nach Anteil an Checkouts.

Sehr vault-sicher, für Partner unberechenbar. Als Ergänzung später möglich, nicht als Startmodell.

**D. Vault lassen, nur Jahresdeckel senken**

Kaschiert das Problem. Partner bleiben an einer IFR-Prozentformel hängen, die niemand in Euro denken kann.

**E. Mehr Verträge (Lending an, Payment-Modell an, DAO an)**

Erhöht Komplexität, bevor ein Sale existiert. Das Problem ist nicht fehlende Module. Das Problem ist fehlende Kopplung zwischen Rabatt und Prämie.

## 10. Empfohlene Umsetzung in drei Stufen

Nicht sofort den nächsten großen Solidity-Wurf.

**Stufe 0 — jetzt, vor Reward-Aktivierung (1–2 Wochen)**

- Wiki und One-Pager sprachlich trennen: Use-Case vs. Subvention.
- Schriftlich festlegen: Rewards können pausieren, Checkouts nicht.
- 3–5 Pilotpartner auswählen, denen man die Euro-Logik vorher erklärt.
- Off-chain oder semi-manual Accounting genau nach der neuen Formel. Beträge sind winzig; das ist akzeptabel.

**Stufe 1 — Parameter on-chain, Logik hart (2–6 Wochen)**

- `recordLockReward` durch `recordRedeemReward(partnerId, discountUSD, lockAmount, twap)` ersetzen oder wrappen.
- Caps in USD-Wei-Äquivalent oder in einer Stable-internen Rechnungseinheit, Auszahlung in IFR.
- Pause-Schalter bei unfrechem TWAP / zu dünnem Pool.
- Dashboard für Budget und Vault.

**Stufe 2 — Einnahmen koppeln (erst wenn Stufe 1 echte Checkouts sieht)**

- Checkout-Fee aktivieren.
- `B_Tag` automatisch an 7-Tage-Einnahmen binden.
- Buyback-Refill als Puffer behalten, nicht als Versprechen.

DAO und Two-Chamber-Voting sind dafür nicht nötig. Das ist Parameter-Governance über den bestehenden Timelock.

## 11. Konkreter Text, den das Team intern beschließen könnte

Beschlussvorschlag:

1. PartnerVault-Rewards werden nicht mehr als Prozentsatz des Lockbetrags berechnet.
2. Bemessungsgrundlage ist der nachweisbar gewährte Rabatt in Fiat, ausgezahlt in IFR zum 24h-TWAP.
3. Auslöser ist ausschließlich der einmalige Redeem eines genehmigten Checkouts.
4. Es gelten Event-, Partner-Monats- und globale Tagesdeckel in Fiat.
5. Das Tagesbudget darf den gleitenden Einnahmen aus Checkout-Fees und Transferfees nicht dauerhaft vorauseilen; eine befristete Bootstrap-Ausnahme aus den 40 Mio. IFR ist zulässig und endet an einem veröffentlichten Datum.
6. Fehlt ein belastbarer Marktpreis, werden Rewards pausiert. Der Lock-Check bleibt aktiv.
7. Lange Vesting-Perioden gelten erst ab einer noch festzulegenden Mindestprämie; darunter gilt Kurzvesting, damit der Anreiz real ist.

## 12. Risiken der vorgeschlagenen Lösung

- **Oracle-Risiko:** Ein dünner Uniswap-Pool kann TWAP verzerren. Deshalb Pause-Regel und Mindestliquidität.
- **Zu kleine Prämien:** Große Händler kommen für 50 €/Monat nicht. Das ist akzeptabel. Zuerst sollen kleine, echte Seller funktionieren.
- **Checkout-Fee als Reibung:** Manche Partner wollen 0 Gebühr. Dann bekommen sie nur Listing und Badge, keinen Reward.
- **Umstellungsaufwand:** Bestehende Wiki-Beispiele mit „15 % von 1.000 IFR" müssen ersetzt werden. Besser jetzt als nach dem ersten On-Chain-Reward.
- **Kein Wundermittel gegen fehlende Nachfrage:** Eine bessere Formel erzeugt keine Kunden. Sie verhindert nur, dass die wenigen Kunden als Vorwand dienen, den Vault zu leeren.

## 13. Schlussfolgerung

Das Problem ist nicht, dass 40 Mio. IFR „zu wenig" sind.

Das Problem ist, dass eine prozentuale IFR-Prämie auf Locks gleichzeitig

- bei Mini-Preis farmbar,
- bei steigendem Preis zu teuer,
- ohne Volumen nicht nachfüllbar
- und vom echten Rabatt entkoppelt ist.

Die Lösung ist deshalb keine noch aggressivere Formel und kein bloßes Anhängen des Spotpreises.

Die Lösung ist:

**Rabatt in Euro messen, IFR nur als Auszahlung nutzen, nur echte Einlösungen belohnen, hart deckeln, Budget an Einnahmen binden, Use-Case vom Vault unabhängig machen.**

Dann bleibt der Partner-Anreiz lesbar.

Dann kann der PartnerVault schrumpfen, aber nicht still leergefarmt werden.

Und dann überlebt der Shop auch dann, wenn der Vault irgendwann nur noch das zahlt, was das Ökosystem wirklich einnimmt.

**Nächster sinnvoller Schritt:** 30-Minuten-Call mit Council, Pilotpartner-Liste, Entscheidung über Startparameter, Freeze der alten Lock-%-Kommunikation.
