import { useEffect, useState } from "react";
import { BigNumber } from "ethers";
import { Contracts } from "../hooks/useContracts";
import { formatIFR, formatIFRFull, bpsToPercent } from "../utils/format";

interface Stats {
  totalSupply: BigNumber;
  totalLocked: BigNumber;
  rewardBps: number;
  annualEmissionCap: BigNumber;
  totalRewarded: BigNumber;
  yearlyEmitted: BigNumber;
  totalAllocated: BigNumber;
  totalClaimed: BigNumber;
  ifrLockAddr: string;
  partnerPool: BigNumber;
  feeRouterBps: number;
  feeRouterPaused: boolean;
}

function ProgressBar({ value, max, label, color }: { value: BigNumber; max: BigNumber; label: string; color: string }) {
  const pct = max.gt(0) ? value.mul(10000).div(max).toNumber() / 100 : 0;
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-ifr-muted">{label}</span>
        <span className="text-gray-300">{pct.toFixed(1)}%</span>
      </div>
      <div className="h-2 bg-ifr-input rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <div className="flex justify-between text-xs mt-1 text-ifr-muted">
        <span>{formatIFR(value)}</span>
        <span>{formatIFR(max)}</span>
      </div>
    </div>
  );
}

export default function Overview({ contracts }: { contracts: Contracts }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [
          totalSupply,
          totalLocked,
          rewardBps,
          annualEmissionCap,
          totalRewarded,
          yearlyEmitted,
          totalAllocated,
          totalClaimed,
          ifrLockAddr,
          partnerPool,
          feeRouterBps,
          feeRouterPaused,
        ] = await Promise.all([
          contracts.token.totalSupply(),
          contracts.ifrLock.totalLocked(),
          contracts.partnerVault.rewardBps(),
          contracts.partnerVault.annualEmissionCap(),
          contracts.partnerVault.totalRewarded(),
          contracts.partnerVault.yearlyEmitted(),
          contracts.partnerVault.totalAllocated(),
          contracts.partnerVault.totalClaimed(),
          contracts.partnerVault.ifrLock(),
          contracts.partnerVault.PARTNER_POOL(),
          contracts.feeRouter.protocolFeeBps(),
          contracts.feeRouter.paused(),
        ]);
        if (!cancelled) {
          setStats({
            totalSupply,
            totalLocked,
            rewardBps: rewardBps.toNumber(),
            annualEmissionCap,
            totalRewarded,
            yearlyEmitted,
            totalAllocated,
            totalClaimed,
            ifrLockAddr,
            partnerPool,
            feeRouterBps: feeRouterBps,
            feeRouterPaused: feeRouterPaused,
          });
        }
      } catch (e: unknown) {
        if (!cancelled) setError(e instanceof Error ? e.message : "RPC error");
      }
    }
    load();
    const interval = setInterval(load, 30_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [contracts]);

  if (error) {
    return <div className="bg-ifr-red/10 border border-ifr-red/30 rounded-lg p-4 text-ifr-red text-sm">{error}</div>;
  }
  if (!stats) {
    return <div className="text-ifr-muted text-center py-12">Loading on-chain data...</div>;
  }

  const lockRatioBps = stats.totalSupply.gt(0)
    ? stats.totalLocked.mul(10000).div(stats.totalSupply).toNumber()
    : 0;
  const lockRatioPct = (lockRatioBps / 100).toFixed(2);

  const throttleEnabled = stats.ifrLockAddr !== "0x0000000000000000000000000000000000000000";

  // Calculate effective BPS (mirrors contract logic)
  let effectiveBps = stats.rewardBps;
  if (throttleEnabled) {
    if (lockRatioBps < 100) {
      effectiveBps = stats.rewardBps;
    } else if (lockRatioBps >= 5000) {
      effectiveBps = 500; // MIN_REWARD_BPS
    } else {
      const drop = ((stats.rewardBps - 500) * (lockRatioBps - 100)) / (5000 - 100);
      effectiveBps = stats.rewardBps - Math.floor(drop);
    }
  }

  return (
    <div className="space-y-6">
      {/* Token Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <StatCard label="Total Supply" value={formatIFRFull(stats.totalSupply) + " IFR"} />
        <StatCard label="Total Locked (IFRLock)" value={formatIFRFull(stats.totalLocked) + " IFR"} sub={`Lock Ratio: ${lockRatioPct}%`} />
        <StatCard
          label="Algo Throttle"
          value={throttleEnabled ? "Enabled" : "Disabled"}
          sub={throttleEnabled ? `Effective: ${bpsToPercent(effectiveBps)} (base: ${bpsToPercent(stats.rewardBps)})` : `Flat rate: ${bpsToPercent(stats.rewardBps)}`}
          accent={throttleEnabled}
        />
      </div>

      {/* PartnerVault Stats */}
      <div className="bg-ifr-card border border-ifr-border rounded-lg p-5 space-y-5">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">PartnerVault</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <ProgressBar
            value={stats.totalRewarded}
            max={stats.partnerPool}
            label="Total Rewarded / Pool (40M)"
            color="bg-ifr-accent"
          />
          <ProgressBar
            value={stats.yearlyEmitted}
            max={stats.annualEmissionCap}
            label="Yearly Emitted / Annual Cap"
            color="bg-ifr-yellow"
          />
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 pt-2">
          <MiniStat label="Reward BPS" value={bpsToPercent(stats.rewardBps)} />
          <MiniStat label="Total Allocated" value={formatIFR(stats.totalAllocated)} />
          <MiniStat label="Total Claimed" value={formatIFR(stats.totalClaimed)} />
          <MiniStat label="Annual Cap" value={formatIFR(stats.annualEmissionCap)} />
        </div>
      </div>

      {/* FeeRouter Stats */}
      <div className="bg-ifr-card border border-ifr-border rounded-lg p-5 space-y-3">
        <h2 className="text-sm font-semibold text-gray-300 uppercase tracking-wide">FeeRouter</h2>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          <MiniStat label="Protocol Fee" value={bpsToPercent(stats.feeRouterBps)} />
          <MiniStat label="Fee Cap" value="0.25% (25 bps)" />
          <div>
            <div className="text-xs text-ifr-muted">Status</div>
            <div className={`text-sm font-medium ${stats.feeRouterPaused ? "text-ifr-red" : "text-ifr-green"}`}>
              {stats.feeRouterPaused ? "Paused" : "Active"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="bg-ifr-card border border-ifr-border rounded-lg p-4">
      <div className="text-xs text-ifr-muted mb-1">{label}</div>
      <div className={`text-lg font-bold ${accent ? "text-ifr-green" : "text-gray-100"}`}>{value}</div>
      {sub && <div className="text-xs text-ifr-muted mt-1">{sub}</div>}
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-ifr-muted">{label}</div>
      <div className="text-sm font-medium text-gray-200">{value}</div>
    </div>
  );
}
