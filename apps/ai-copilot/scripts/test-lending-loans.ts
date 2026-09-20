import assert from "node:assert/strict";
import { Interface } from "ethers";
import {
  LENDING_LOAN_ABI,
  LENDING_LOAN_COMPONENTS,
  parseLendingLoan,
  serializeLendingLoan,
} from "../server/lending-loans.js";

const contractInterface = new Interface(LENDING_LOAN_ABI);
const getLoan = contractInterface.getFunction("getLoan");
assert.ok(getLoan);
const resultComponents = getLoan.outputs[0].components;
assert.ok(resultComponents);
assert.deepEqual(
  resultComponents.map((component) => component.name),
  [...LENDING_LOAN_COMPONENTS],
);

const oldShiftedAbi = new Interface([
  "function getLoan(uint256 loanId) view returns (tuple(address borrower, uint256 ifrAmount, uint256 ethCollateral, uint256 startTime, uint256 duration, uint256 monthlyRateBps, uint256 repaidAt, bool active))",
]);
const oldComponents = oldShiftedAbi.getFunction("getLoan")?.outputs[0].components;
assert.ok(oldComponents);
assert.notDeepEqual(
  oldComponents.map((component) => component.name),
  [...LENDING_LOAN_COMPONENTS],
  "The former shifted ABI must fail the canonical component-order assertion",
);

const fixture = [
  "0x1111111111111111111111111111111111111111",
  7n,
  12_345_678_901n,
  3_210_000_000_000_000_000n,
  1_700_000_000n,
  86_400n,
  375n,
  true,
] as const;

const parsed = parseLendingLoan(fixture);
assert.equal(parsed.offerId, 7n);
assert.equal(parsed.ifrAmount, 12_345_678_901n);
assert.equal(parsed.ethCollateral, 3_210_000_000_000_000_000n);

const serialized = serializeLendingLoan(42, fixture);
assert.deepEqual(serialized, {
  id: 42,
  borrower: "0x1111111111111111111111111111111111111111",
  offerId: "7",
  ifrAmount: "12.345678901",
  ethCollateral: "3.21",
  startTime: 1_700_000_000,
  duration: 86_400,
  dueDate: "2023-11-15",
  monthlyRate: "3.75%",
  active: true,
});

assert.throws(() => parseLendingLoan(fixture.slice(0, 7)), /exactly 8 fields/);
assert.throws(
  () => parseLendingLoan([...fixture.slice(0, 2), 12_345_678_901, ...fixture.slice(3)]),
  /ifrAmount must be an unsigned bigint/,
);

console.log("[lending-loans-test] PASS");
