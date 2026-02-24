import { useEffect, useState } from "react";
import { BigNumber } from "ethers";
import { Contracts } from "../hooks/useContracts";
import { formatIFR, shortenAddress, shortenBytes32, formatTimestamp } from "../utils/format";
import { ETHERSCAN_BASE } from "../config";

interface PartnerRow {
  id: string;
  beneficiary: string;
  maxAllocation: BigNumber;
  unlockedTotal: BigNumber;
  rewardAccrued: BigNumber;
  claimedTotal: BigNumber;
  vestingStart: number;
  vestingDuration: number;
  cliff: number;
  active: boolean;
  milestonesFinal: boolean;
  tier: number;
  claimable: BigNumber;
}

export default function Partners({ contracts }: { contracts: Contracts }) {
  const [partners, setPartners] = useState<PartnerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Fetch PartnerCreated events from block 0
        const filter = contracts.partnerVault.filters.PartnerCreated();
        const events = await contracts.partnerVault.queryFilter(filter, 0, "latest");

        const rows: PartnerRow[] = [];
        for (const ev of events) {
          const partnerId = ev.args!.partnerId as string;
          const [info, claimable] = await Promise.all([
            contracts.partnerVault.partners(partnerId),
            contracts.partnerVault.claimable(partnerId),
          ]);
          rows.push({
            id: partnerId,
            beneficiary: info.beneficiary,
            maxAllocation: info.maxAllocation,
            unlockedTotal: info.unlockedTotal,
            rewardAccrued: info.rewardAccrued,
            claimedTotal: info.claimedTotal,
            vestingStart: info.vestingStart,
            vestingDuration: info.vestingDuration,
            cliff: info.cliff,
            active: info.active,
            milestonesFinal: info.milestonesFinal,
            tier: info.tier,
            claimable,
          });
        }
        if (!cancelled) {
          setPartners(rows);
          setLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load partners");
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [contracts]);

  if (error) {
    return <div className="bg-ifr-red/10 border border-ifr-red/30 rounded-lg p-4 text-ifr-red text-sm">{error}</div>;
  }
  if (loading) {
    return <div className="text-ifr-muted text-center py-12">Loading partner events...</div>;
  }
  if (partners.length === 0) {
    return (
      <div className="bg-ifr-card border border-ifr-border rounded-lg p-8 text-center text-ifr-muted">
        No partners created yet.
      </div>
    );
  }

  return (
    <div className="bg-ifr-card border border-ifr-border rounded-lg overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-ifr-border text-ifr-muted text-xs uppercase">
            <th className="px-4 py-3 text-left">Partner ID</th>
            <th className="px-4 py-3 text-left">Beneficiary</th>
            <th className="px-4 py-3 text-right">Max Alloc</th>
            <th className="px-4 py-3 text-right">Unlocked</th>
            <th className="px-4 py-3 text-right">Rewards</th>
            <th className="px-4 py-3 text-right">Claimed</th>
            <th className="px-4 py-3 text-right">Claimable</th>
            <th className="px-4 py-3 text-center">Vesting Start</th>
            <th className="px-4 py-3 text-center">Status</th>
          </tr>
        </thead>
        <tbody>
          {partners.map((p) => (
            <tr key={p.id} className="border-b border-ifr-border/50 hover:bg-ifr-input/30">
              <td className="px-4 py-3 font-mono text-xs">{shortenBytes32(p.id)}</td>
              <td className="px-4 py-3">
                <a
                  href={`${ETHERSCAN_BASE}/address/${p.beneficiary}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-ifr-accent hover:underline font-mono text-xs"
                >
                  {shortenAddress(p.beneficiary)}
                </a>
              </td>
              <td className="px-4 py-3 text-right">{formatIFR(p.maxAllocation)}</td>
              <td className="px-4 py-3 text-right">{formatIFR(p.unlockedTotal)}</td>
              <td className="px-4 py-3 text-right">{formatIFR(p.rewardAccrued)}</td>
              <td className="px-4 py-3 text-right">{formatIFR(p.claimedTotal)}</td>
              <td className="px-4 py-3 text-right font-medium text-ifr-green">
                {p.claimable.gt(0) ? formatIFR(p.claimable) : "—"}
              </td>
              <td className="px-4 py-3 text-center text-xs">
                {p.vestingStart > 0 ? formatTimestamp(p.vestingStart) : "—"}
              </td>
              <td className="px-4 py-3 text-center">
                {p.active ? (
                  <span className="text-xs bg-ifr-green/20 text-ifr-green px-2 py-0.5 rounded">Active</span>
                ) : (
                  <span className="text-xs bg-ifr-muted/20 text-ifr-muted px-2 py-0.5 rounded">Inactive</span>
                )}
                {p.milestonesFinal && (
                  <span className="ml-1 text-xs bg-ifr-yellow/20 text-ifr-yellow px-2 py-0.5 rounded">Final</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
