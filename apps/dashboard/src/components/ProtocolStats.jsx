import { useState, useEffect } from "react";
import { formatIFRFull, bpsToPercent } from "../utils/format";

export default function ProtocolStats({ contracts }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [totalLocked, vaultBalance, feeBps, feeRouterPaused, rewardBps, totalRewarded] =
          await Promise.all([
            contracts.ifrLock.totalLocked(),
            contracts.token.balanceOf(contracts.partnerVault.address),
            contracts.feeRouter.protocolFeeBps(),
            contracts.feeRouter.paused(),
            contracts.partnerVault.rewardBps(),
            contracts.partnerVault.totalRewarded(),
          ]);

        if (!cancelled) {
          setData({ totalLocked, vaultBalance, feeBps, feeRouterPaused, rewardBps, totalRewarded });
          setLastUpdate(new Date());
          setLoading(false);
        }
      } catch (err) {
        console.error("Failed to load protocol stats:", err);
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const interval = setInterval(load, 30000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [contracts]);

  if (loading) return <div className="card">Loading protocol stats...</div>;
  if (!data) return <div className="card">Failed to load protocol stats.</div>;

  return (
    <div className="card">
      <h2>Protocol Stats</h2>
      <div className="token-grid">
        <div className="stat">
          <span className="stat-label">Total IFR Locked</span>
          <span className="stat-value">{formatIFRFull(data.totalLocked)} IFR</span>
        </div>
        <div className="stat">
          <span className="stat-label">PartnerVault Balance</span>
          <span className="stat-value">{formatIFRFull(data.vaultBalance)} IFR</span>
        </div>
        <div className="stat">
          <span className="stat-label">Protocol Fee (FeeRouter)</span>
          <span className="stat-value">{bpsToPercent(data.feeBps)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">FeeRouter Status</span>
          <span className="stat-value" style={{ color: data.feeRouterPaused ? "var(--red)" : "var(--green)" }}>
            {data.feeRouterPaused ? "Paused" : "Active"}
          </span>
        </div>
      </div>

      <h3>Partner Rewards</h3>
      <div className="token-grid">
        <div className="stat">
          <span className="stat-label">Reward Rate</span>
          <span className="stat-value">{bpsToPercent(data.rewardBps)}</span>
        </div>
        <div className="stat">
          <span className="stat-label">Total Rewarded</span>
          <span className="stat-value">{formatIFRFull(data.totalRewarded)} IFR</span>
        </div>
      </div>

      {lastUpdate && (
        <div className="muted">
          Last refresh: {lastUpdate.toLocaleTimeString("de-DE")} (auto-refresh 30s)
        </div>
      )}
    </div>
  );
}
