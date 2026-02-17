import { useState, useEffect } from "react";
import { ethers } from "ethers";
import {
  formatIFRFull,
  bpsToPercent,
  calcBurnedPercent,
  shortenAddress,
  INITIAL_SUPPLY,
  IFR_DECIMALS,
} from "../utils/format";

export default function TokenOverview({ contracts, account }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [
          name,
          symbol,
          decimals,
          totalSupply,
          senderBurnBps,
          recipientBurnBps,
          poolFeeBps,
          poolFeeReceiver,
          owner,
          totalBurned,
          pendingBurn,
        ] = await Promise.all([
          contracts.token.name(),
          contracts.token.symbol(),
          contracts.token.decimals(),
          contracts.token.totalSupply(),
          contracts.token.senderBurnBps(),
          contracts.token.recipientBurnBps(),
          contracts.token.poolFeeBps(),
          contracts.token.poolFeeReceiver(),
          contracts.token.owner(),
          contracts.burnReserve.totalBurned(),
          contracts.burnReserve.pendingBurn(),
        ]);

        let userBalance = ethers.BigNumber.from(0);
        if (account) {
          userBalance = await contracts.token.balanceOf(account);
        }

        const initial = ethers.utils.parseUnits(INITIAL_SUPPLY, IFR_DECIMALS);
        const burned = initial.sub(totalSupply);

        if (!cancelled) {
          setData({
            name,
            symbol,
            decimals,
            totalSupply,
            burned,
            burnedPercent: calcBurnedPercent(totalSupply),
            userBalance,
            senderBurnBps,
            recipientBurnBps,
            poolFeeBps,
            poolFeeReceiver,
            owner,
            totalBurned,
            pendingBurn,
          });
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load token data:", err);
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [contracts, account]);

  if (loading) return <div className="card">Loading token data...</div>;
  if (!data) return <div className="card">Failed to load token data.</div>;

  return (
    <div className="card">
      <h2>Token Overview</h2>
      <div className="token-grid">
        <div className="stat">
          <span className="stat-label">Token</span>
          <span className="stat-value">{data.name} ({data.symbol})</span>
        </div>
        <div className="stat">
          <span className="stat-label">Decimals</span>
          <span className="stat-value">{data.decimals}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total Supply</span>
          <span className="stat-value">{formatIFRFull(data.totalSupply)} IFR</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total Burned</span>
          <span className="stat-value burn">{formatIFRFull(data.burned)} IFR</span>
        </div>
      </div>

      <div className="burn-bar-container">
        <div className="burn-bar-label">
          Burn Progress: {data.burnedPercent}%
        </div>
        <div className="burn-bar">
          <div className="burn-bar-fill" style={{ width: `${Math.min(data.burnedPercent, 100)}%` }} />
        </div>
      </div>

      {account && (
        <div className="stat highlight">
          <span className="stat-label">Your Balance</span>
          <span className="stat-value">{formatIFRFull(data.userBalance)} IFR</span>
        </div>
      )}

      <h3>Fee Rates</h3>
      <table className="table">
        <thead>
          <tr><th>Fee</th><th>Rate</th></tr>
        </thead>
        <tbody>
          <tr><td>Sender Burn</td><td>{bpsToPercent(data.senderBurnBps)}</td></tr>
          <tr><td>Recipient Burn</td><td>{bpsToPercent(data.recipientBurnBps)}</td></tr>
          <tr><td>Pool Fee</td><td>{bpsToPercent(data.poolFeeBps)}</td></tr>
          <tr>
            <td>Total</td>
            <td>{bpsToPercent(data.senderBurnBps.add(data.recipientBurnBps).add(data.poolFeeBps))}</td>
          </tr>
        </tbody>
      </table>

      <h3>Burn Reserve</h3>
      <div className="token-grid">
        <div className="stat">
          <span className="stat-label">Pending Burn</span>
          <span className="stat-value">{formatIFRFull(data.pendingBurn)} IFR</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total Burned (Reserve)</span>
          <span className="stat-value burn">{formatIFRFull(data.totalBurned)} IFR</span>
        </div>
      </div>

      <div className="stat small">
        <span className="stat-label">Token Owner</span>
        <span className="stat-value mono">{shortenAddress(data.owner)}</span>
      </div>
    </div>
  );
}
