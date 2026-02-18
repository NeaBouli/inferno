import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { ADDRESSES, ETHERSCAN_BASE } from "../config/addresses";
import { shortenAddress } from "../utils/format";

const ACTION_TEMPLATES = [
  {
    label: "setFeeRates(uint256,uint256,uint256)",
    fields: [
      { name: "senderBurnBps", label: "Sender Burn (bps)", placeholder: "200" },
      { name: "recipientBurnBps", label: "Recipient Burn (bps)", placeholder: "50" },
      { name: "poolFeeBps", label: "Pool Fee (bps)", placeholder: "100" },
    ],
    encode: (values) =>
      new ethers.utils.Interface([
        "function setFeeRates(uint256,uint256,uint256)",
      ]).encodeFunctionData("setFeeRates", [
        values.senderBurnBps,
        values.recipientBurnBps,
        values.poolFeeBps,
      ]),
  },
  {
    label: "setFeeExempt(address,bool)",
    fields: [
      { name: "account", label: "Address", placeholder: "0x..." },
      { name: "exempt", label: "Exempt (true/false)", placeholder: "true" },
    ],
    encode: (values) =>
      new ethers.utils.Interface([
        "function setFeeExempt(address,bool)",
      ]).encodeFunctionData("setFeeExempt", [
        values.account,
        values.exempt === "true",
      ]),
  },
  {
    label: "setPoolFeeReceiver(address)",
    fields: [
      { name: "receiver", label: "New Receiver", placeholder: "0x..." },
    ],
    encode: (values) =>
      new ethers.utils.Interface([
        "function setPoolFeeReceiver(address)",
      ]).encodeFunctionData("setPoolFeeReceiver", [values.receiver]),
  },
];

function getProposalStatus(proposal, now) {
  if (proposal.cancelled) return "Cancelled";
  if (proposal.executed) return "Executed";
  if (now >= proposal.eta) return "Ready";
  return "Pending";
}

function getStatusClass(status) {
  switch (status) {
    case "Pending": return "gov-status-pending";
    case "Ready": return "gov-status-ready";
    case "Executed": return "gov-status-executed";
    case "Cancelled": return "gov-status-cancelled";
    default: return "";
  }
}

function formatCountdown(eta, now) {
  if (now >= eta) return "Ready";
  const diff = eta - now;
  const h = Math.floor(diff / 3600);
  const m = Math.floor((diff % 3600) / 60);
  if (h > 24) {
    const d = Math.floor(h / 24);
    return `${d}d ${h % 24}h`;
  }
  return `${h}h ${m}m`;
}

function decodeCalldata(data) {
  const iface = new ethers.utils.Interface([
    "function setFeeRates(uint256,uint256,uint256)",
    "function setFeeExempt(address,bool)",
    "function setPoolFeeReceiver(address)",
    "function setDelay(uint256)",
    "function setGuardian(address)",
    "function setOwner(address)",
  ]);
  try {
    const parsed = iface.parseTransaction({ data });
    const args = parsed.args.map((a) =>
      ethers.BigNumber.isBigNumber(a) ? a.toString() : String(a)
    );
    return `${parsed.name}(${args.join(", ")})`;
  } catch {
    if (data.length <= 10) return data;
    return data.slice(0, 10) + "...";
  }
}

export default function Governance({ contracts, account, signer }) {
  const [proposals, setProposals] = useState([]);
  const [govInfo, setGovInfo] = useState({ owner: null, guardian: null, delay: null, count: 0 });
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Math.floor(Date.now() / 1000));

  // Propose form state
  const [mode, setMode] = useState("template"); // "template" | "manual"
  const [selectedTemplate, setSelectedTemplate] = useState(0);
  const [templateValues, setTemplateValues] = useState({});
  const [manualTarget, setManualTarget] = useState("");
  const [manualCalldata, setManualCalldata] = useState("");
  const [proposeTarget, setProposeTarget] = useState(ADDRESSES.InfernoToken);
  const [txStatus, setTxStatus] = useState(null);

  const isOwner = account && govInfo.owner && account.toLowerCase() === govInfo.owner.toLowerCase();
  const isGuardian = account && govInfo.guardian && account.toLowerCase() === govInfo.guardian.toLowerCase();

  const loadGovernanceData = useCallback(async () => {
    try {
      const [ownerAddr, guardianAddr, delayVal, countVal] = await Promise.all([
        contracts.governance.owner(),
        contracts.governance.guardian(),
        contracts.governance.delay(),
        contracts.governance.proposalCount(),
      ]);

      const count = countVal.toNumber();
      setGovInfo({
        owner: ownerAddr,
        guardian: guardianAddr,
        delay: delayVal.toNumber(),
        count,
      });

      if (count > 0) {
        const fetches = [];
        for (let i = 0; i < count; i++) {
          fetches.push(contracts.governance.getProposal(i));
        }
        const results = await Promise.all(fetches);
        setProposals(
          results.map((r, i) => ({
            id: i,
            target: r.target,
            data: r.data,
            eta: r.eta.toNumber(),
            executed: r.executed,
            cancelled: r.cancelled,
          }))
        );
      } else {
        setProposals([]);
      }
    } catch (err) {
      console.error("Governance load error:", err);
    } finally {
      setLoading(false);
    }
  }, [contracts]);

  useEffect(() => {
    loadGovernanceData();
  }, [loadGovernanceData]);

  // Countdown timer
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  async function handlePropose() {
    if (!signer) return;
    setTxStatus({ type: "pending", msg: "Sending propose transaction..." });
    try {
      let target, calldata;
      if (mode === "template") {
        target = proposeTarget;
        const template = ACTION_TEMPLATES[selectedTemplate];
        calldata = template.encode(templateValues);
      } else {
        target = manualTarget;
        calldata = manualCalldata;
      }

      const tx = await contracts.governance.connect(signer).propose(target, calldata);
      setTxStatus({ type: "pending", msg: `TX sent: ${tx.hash.slice(0, 14)}...` });
      await tx.wait();
      setTxStatus({ type: "success", msg: "Proposal created!", hash: tx.hash });
      setTemplateValues({});
      setManualTarget("");
      setManualCalldata("");
      loadGovernanceData();
    } catch (err) {
      const reason = err.reason || err.message || "Transaction failed";
      setTxStatus({ type: "error", msg: reason });
    }
  }

  async function handleExecute(proposalId) {
    if (!signer) return;
    setTxStatus({ type: "pending", msg: `Executing proposal #${proposalId}...` });
    try {
      const tx = await contracts.governance.connect(signer).execute(proposalId);
      await tx.wait();
      setTxStatus({ type: "success", msg: `Proposal #${proposalId} executed!`, hash: tx.hash });
      loadGovernanceData();
    } catch (err) {
      const reason = err.reason || err.message || "Execution failed";
      setTxStatus({ type: "error", msg: reason });
    }
  }

  async function handleCancel(proposalId) {
    if (!signer) return;
    setTxStatus({ type: "pending", msg: `Cancelling proposal #${proposalId}...` });
    try {
      const tx = await contracts.governance.connect(signer).cancel(proposalId);
      await tx.wait();
      setTxStatus({ type: "success", msg: `Proposal #${proposalId} cancelled!`, hash: tx.hash });
      loadGovernanceData();
    } catch (err) {
      const reason = err.reason || err.message || "Cancel failed";
      setTxStatus({ type: "error", msg: reason });
    }
  }

  if (loading) {
    return (
      <div className="card">
        <h2>Governance</h2>
        <p className="muted">Loading governance data...</p>
      </div>
    );
  }

  const template = ACTION_TEMPLATES[selectedTemplate];

  return (
    <div className="card gov-card">
      <h2>Governance</h2>

      {/* ── Info Box ──────────────────────────────── */}
      <div className="gov-info">
        <div className="gov-info-row">
          <span className="gov-info-label">Contract</span>
          <a
            href={ETHERSCAN_BASE + ADDRESSES.Governance}
            target="_blank"
            rel="noopener noreferrer"
            className="address-link"
          >
            {shortenAddress(ADDRESSES.Governance)}
          </a>
        </div>
        <div className="gov-info-row">
          <span className="gov-info-label">Owner</span>
          <span className="gov-info-value mono">
            {shortenAddress(govInfo.owner)}
            {isOwner && <span className="gov-you-badge">You</span>}
          </span>
        </div>
        <div className="gov-info-row">
          <span className="gov-info-label">Guardian</span>
          <span className="gov-info-value mono">
            {shortenAddress(govInfo.guardian)}
            {isGuardian && <span className="gov-you-badge">You</span>}
          </span>
        </div>
        <div className="gov-info-row">
          <span className="gov-info-label">Timelock Delay</span>
          <span className="gov-info-value">{govInfo.delay / 3600}h</span>
        </div>
        <div className="gov-info-row">
          <span className="gov-info-label">Total Proposals</span>
          <span className="gov-info-value">{govInfo.count}</span>
        </div>
      </div>

      {/* ── Proposals List ────────────────────────── */}
      <h3>Proposals</h3>
      {proposals.length === 0 ? (
        <p className="muted">No proposals yet.</p>
      ) : (
        <div className="gov-proposals">
          {[...proposals].reverse().map((p) => {
            const status = getProposalStatus(p, now);
            const statusClass = getStatusClass(status);
            const canExecute = isOwner && status === "Ready";
            const canCancel = (isOwner || isGuardian) && (status === "Pending" || status === "Ready");

            return (
              <div key={p.id} className={`gov-proposal ${statusClass}`}>
                <div className="gov-proposal-header">
                  <span className="gov-proposal-id">#{p.id}</span>
                  <span className={`gov-status-badge ${statusClass}`}>{status}</span>
                </div>
                <div className="gov-proposal-details">
                  <div className="gov-detail">
                    <span className="gov-detail-label">Target</span>
                    <a
                      href={ETHERSCAN_BASE + p.target}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="address-link"
                    >
                      {shortenAddress(p.target)}
                    </a>
                  </div>
                  <div className="gov-detail">
                    <span className="gov-detail-label">Action</span>
                    <span className="gov-detail-value mono">{decodeCalldata(p.data)}</span>
                  </div>
                  <div className="gov-detail">
                    <span className="gov-detail-label">ETA</span>
                    <span className="gov-detail-value">
                      {new Date(p.eta * 1000).toLocaleString()}
                      {status === "Pending" && (
                        <span className="gov-countdown"> ({formatCountdown(p.eta, now)})</span>
                      )}
                    </span>
                  </div>
                </div>
                {(canExecute || canCancel) && (
                  <div className="gov-proposal-actions">
                    {canExecute && (
                      <button className="btn btn-execute" onClick={() => handleExecute(p.id)}>
                        Execute
                      </button>
                    )}
                    {canCancel && (
                      <button className="btn btn-cancel" onClick={() => handleCancel(p.id)}>
                        Cancel
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* ── Create Proposal (Owner only) ──────────── */}
      {isOwner && (
        <>
          <h3>Create Proposal</h3>
          <div className="gov-create">
            <div className="gov-mode-tabs">
              <button
                className={`btn btn-small ${mode === "template" ? "btn-active" : ""}`}
                onClick={() => setMode("template")}
              >
                Template
              </button>
              <button
                className={`btn btn-small ${mode === "manual" ? "btn-active" : ""}`}
                onClick={() => setMode("manual")}
              >
                Manual
              </button>
            </div>

            {mode === "template" ? (
              <>
                <div className="form-group">
                  <label>Target Contract</label>
                  <select
                    className="input"
                    value={proposeTarget}
                    onChange={(e) => setProposeTarget(e.target.value)}
                  >
                    <option value={ADDRESSES.InfernoToken}>InfernoToken</option>
                    <option value={ADDRESSES.LiquidityReserve}>LiquidityReserve</option>
                    <option value={ADDRESSES.BuybackVault}>BuybackVault</option>
                    <option value={ADDRESSES.BurnReserve}>BurnReserve</option>
                    <option value={ADDRESSES.Vesting}>Vesting</option>
                  </select>
                </div>
                <div className="form-group">
                  <label>Action</label>
                  <select
                    className="input"
                    value={selectedTemplate}
                    onChange={(e) => {
                      setSelectedTemplate(Number(e.target.value));
                      setTemplateValues({});
                    }}
                  >
                    {ACTION_TEMPLATES.map((t, i) => (
                      <option key={i} value={i}>{t.label}</option>
                    ))}
                  </select>
                </div>
                {template.fields.map((field) => (
                  <div className="form-group" key={field.name}>
                    <label>{field.label}</label>
                    <input
                      className="input"
                      type="text"
                      placeholder={field.placeholder}
                      value={templateValues[field.name] || ""}
                      onChange={(e) =>
                        setTemplateValues((prev) => ({
                          ...prev,
                          [field.name]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))}
              </>
            ) : (
              <>
                <div className="form-group">
                  <label>Target Address</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="0x..."
                    value={manualTarget}
                    onChange={(e) => setManualTarget(e.target.value)}
                  />
                </div>
                <div className="form-group">
                  <label>Calldata (hex)</label>
                  <input
                    className="input"
                    type="text"
                    placeholder="0x..."
                    value={manualCalldata}
                    onChange={(e) => setManualCalldata(e.target.value)}
                  />
                </div>
              </>
            )}

            <button
              className="btn btn-send"
              onClick={handlePropose}
              disabled={!signer}
            >
              Propose
            </button>
          </div>
        </>
      )}

      {/* ── TX Status ─────────────────────────────── */}
      {txStatus && (
        <div className={`tx-result ${txStatus.type}`}>
          {txStatus.msg}
          {txStatus.hash && (
            <>
              {" "}
              <a
                href={`https://sepolia.etherscan.io/tx/${txStatus.hash}`}
                target="_blank"
                rel="noopener noreferrer"
              >
                View TX
              </a>
            </>
          )}
        </div>
      )}
    </div>
  );
}
