# Known Issues

## BBV-001 -- Hardhat Compile fails in `MockRouter.sol`

**Status: RESOLVED**

**Symptom:**
TypeError: Contract or array type expected.
--> contracts/mocks/MockRouter.sol:35:19:
|
35 | amounts = new uint256 (2);
| ^^^^^^^^^^^

**Cause:**
Array allocation in Solidity must use **brackets AND square brackets**:
`new uint256[](2)`
If square brackets are missing or there is a space between the type and brackets (`new uint256 (2)`), the compiler fails.

**Fix steps (check & correct):**
1. Open file:
   - `contracts/mocks/MockRouter.sol`
2. Ensure both locations look exactly like this:
   ```solidity
   amounts = new uint256[](2);
   ```
   in `getAmountsOut(...)`
   in `swapExactETHForTokens(...)`

3. Clean cache & recompile:
   ```bash
   npx hardhat clean && npx hardhat compile
   ```

**Note:**
If the editor or copy/paste swallows the `[]` brackets, type them manually.

For verification:
```bash
grep -n "new uint256" contracts/mocks/MockRouter.sol
# Expected: no matches without [].
grep -n "new uint256\[\]" contracts/mocks/MockRouter.sol
# Expected: matches (at least 2x), e.g. "new uint256[](2)"
```

## BBV-002 -- BuybackVault Tests

**Status: RESOLVED** -- Fixed after BBV-001 resolution. All 26 BuybackVault tests passing.

## Tooling Notes

- Offline compile via solc-JS is prepared in the project.
- Ensure that `node_modules/` is not checked in (see `.gitignore`).
