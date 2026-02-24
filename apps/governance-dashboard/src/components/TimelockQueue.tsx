import { useEffect, useState } from "react";
import { Contracts } from "../hooks/useContracts";
import { shortenAddress, formatTimestamp, formatCountdown } from "../utils/format";
import { ETHERSCAN_BASE } from "../config";

interface Proposal {
  id: number;
  target: string;
  data: string;
  eta: number;
  executed: boolean;
  cancelled: boolean;
}

function decodeStatus(p: Proposal): { label: string; color: string } {
  if (p.executed) return { label: "Executed", color: "bg-ifr-green/20 text-ifr-green" };
  if (p.cancelled) return { label: "Cancelled", color: "bg-ifr-red/20 text-ifr-red" };
  const now = Math.floor(Date.now() / 1000);
  if (now < p.eta) return { label: "Pending", color: "bg-ifr-yellow/20 text-ifr-yellow" };
  return { label: "Ready", color: "bg-ifr-accent/20 text-ifr-accent" };
}

export default function TimelockQueue({ contracts }: { contracts: Contracts }) {
  const [proposals, setProposals] = useState<Proposal[]>([]);
  const [delay, setDelay] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [count, d] = await Promise.all([
          contracts.governance.proposalCount(),
          contracts.governance.delay(),
        ]);
        setDelay(d.toNumber());

        const n = count.toNumber();
        const rows: Proposal[] = [];
        for (let i = 0; i < n; i++) {
          const p = await contracts.governance.getProposal(i);
          rows.push({
            id: i,
            target: p.target,
            data: p.data,
            eta: p.eta.toNumber(),
            executed: p.executed,
            cancelled: p.cancelled,
          });
        }
        if (!cancelled) {
          setProposals(rows);
          setLoading(false);
        }
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load proposals");
          setLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [contracts]);

  // Tick every second for countdown
  useEffect(() => {
    const interval = setInterval(() => setTick((t) => t + 1), 1000);
    return () => clearInterval(interval);
  }, []);

  if (error) {
    return <div className="bg-ifr-red/10 border border-ifr-red/30 rounded-lg p-4 text-ifr-red text-sm">{error}</div>;
  }
  if (loading) {
    return <div className="text-ifr-muted text-center py-12">Loading proposals...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4 text-sm text-ifr-muted">
        <span>Timelock Delay: <strong className="text-gray-300">{(delay / 3600).toFixed(0)}h</strong></span>
        <span>Total Proposals: <strong className="text-gray-300">{proposals.length}</strong></span>
      </div>

      {proposals.length === 0 ? (
        <div className="bg-ifr-card border border-ifr-border rounded-lg p-8 text-center text-ifr-muted">
          No proposals yet.
        </div>
      ) : (
        <div className="space-y-3">
          {[...proposals].reverse().map((p) => {
            const status = decodeStatus(p);
            return (
              <div key={p.id} className="bg-ifr-card border border-ifr-border rounded-lg p-4">
                <div className="flex items-center gap-3 mb-3">
                  <span className="text-sm font-bold text-gray-200">#{p.id}</span>
                  <span className={`text-xs px-2 py-0.5 rounded ${status.color}`}>{status.label}</span>
                  {!p.executed && !p.cancelled && (
                    <span className="ml-auto text-xs font-mono text-ifr-accent">
                      {formatCountdown(p.eta)}
                    </span>
                  )}
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-ifr-muted">Target: </span>
                    <a
                      href={`${ETHERSCAN_BASE}/address/${p.target}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-ifr-accent hover:underline font-mono"
                    >
                      {shortenAddress(p.target)}
                    </a>
                  </div>
                  <div>
                    <span className="text-ifr-muted">ETA: </span>
                    <span className="text-gray-300">{formatTimestamp(p.eta)}</span>
                  </div>
                </div>
                <div className="mt-2">
                  <span className="text-xs text-ifr-muted">Calldata: </span>
                  <code className="text-xs text-gray-400 break-all bg-ifr-input rounded px-2 py-1 inline-block mt-1 max-w-full overflow-x-auto">
                    {p.data}
                  </code>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
