import { ADDRESSES, ETHERSCAN_BASE } from "../config/addresses";
import { shortenAddress } from "../utils/format";

const CONTRACTS = [
  { name: "InfernoToken", key: "InfernoToken", verified: true },
  { name: "LiquidityReserve", key: "LiquidityReserve", verified: true },
  { name: "Vesting", key: "Vesting", verified: true },
  { name: "BuybackVault", key: "BuybackVault", verified: true },
  { name: "BurnReserve", key: "BurnReserve", verified: true },
  { name: "Governance", key: "Governance", verified: true },
  { name: "LP Pair (IFR/WETH)", key: "LPPair", verified: false },
];

export default function Contracts() {
  return (
    <div className="card">
      <h2>Deployed Contracts</h2>
      <table className="table contracts-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Contract</th>
            <th>Address</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {CONTRACTS.map((c, i) => (
            <tr key={c.key}>
              <td>{i + 1}</td>
              <td>{c.name}</td>
              <td>
                <a
                  href={`${ETHERSCAN_BASE}${ADDRESSES[c.key]}#code`}
                  target="_blank"
                  rel="noreferrer"
                  className="address-link"
                >
                  {shortenAddress(ADDRESSES[c.key])}
                </a>
              </td>
              <td>
                <span className={`status-badge ${c.verified ? "verified" : "unverified"}`}>
                  {c.verified ? "Verified" : "LP Pair"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="muted">Network: Sepolia Testnet (Chain ID: 11155111)</p>
    </div>
  );
}
