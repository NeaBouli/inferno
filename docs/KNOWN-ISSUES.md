# 🔧 Known Issues

## BBV-001 — Hardhat Compile schlägt fehl in `MockRouter.sol`
**Fehlerbild:**  
TypeError: Contract or array type expected.
--> contracts/mocks/MockRouter.sol:35:19:
|
35 | amounts = new uint256 (2);
| ^^^^^^^^^^^

markdown
Code kopieren

**Ursache:**  
Die Array-Allokation muss in Solidity mit **Klammern UND eckigen Klammern** erfolgen:  
`new uint256`  
Wenn eckige Klammern fehlen oder ein Leerzeichen zwischen Typ und Klammern steht (`new uint256 (2)`), schlägt der Compiler fehl.

**Fix-Schritte (prüfen & korrigieren):**
1. Datei öffnen:
   - `contracts/mocks/MockRouter.sol`
2. Sicherstellen, dass beide Stellen exakt so aussehen:
   ```solidity
   amounts = new uint256;
in getAmountsOut(...)

in swapExactETHForTokens(...)

Cache bereinigen & neu kompilieren:

bash
Code kopieren
npx hardhat clean && npx hardhat compile
Hinweis:
Wenn der Editor oder Copy/Paste die []-Klammern verschluckt, bitte manuell tippen.
Zur Verifikation:

bash
Code kopieren
grep -n "new uint256" -n contracts/mocks/MockRouter.sol
# Erwartet: keine Treffer ohne [].
grep -n "new uint256\\[\\]" contracts/mocks/MockRouter.sol
# Erwartet: Treffer (mind. 2x), z.B. "new uint256"
BBV-002 — BuybackVault-Tests 🔴
Status: BuybackVault bleibt vorerst 🔴 (Blocker BBV-001).
Nächste Schritte: Nach Behebung von BBV-001 Tests erneut laufen lassen:

bash
Code kopieren
npx hardhat test test/BuybackVault.test.js
Tooling-Hinweise
Offline-Compile via solc-JS ist im Projekt vorbereitet.

Achte darauf, dass node_modules/ nicht eingecheckt wird (siehe .gitignore).
