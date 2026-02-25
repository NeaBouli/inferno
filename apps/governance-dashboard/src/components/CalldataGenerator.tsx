import { useState } from "react";
import { ethers } from "ethers";
import { ADDRESSES } from "../config";
import { PartnerVaultABI, FeeRouterABI } from "../config/abis";

interface FnDef {
  label: string;
  target: string;
  sig: string;
  params: { name: string; type: string; placeholder: string; hint?: string }[];
}

const FUNCTIONS: FnDef[] = [
  {
    label: "setRewardBps(uint256)",
    target: ADDRESSES.PartnerVault,
    sig: "setRewardBps(uint256)",
    params: [
      { name: "newBps", type: "uint256", placeholder: "1500", hint: "500-2500 (5%-25%)" },
    ],
  },
  {
    label: "setAnnualEmissionCap(uint256)",
    target: ADDRESSES.PartnerVault,
    sig: "setAnnualEmissionCap(uint256)",
    params: [
      { name: "newCap", type: "uint256", placeholder: "4000000000000000", hint: "Raw value (9 decimals). 4M = 4000000000000000" },
    ],
  },
  {
    label: "setAuthorizedCaller(address, bool)",
    target: ADDRESSES.PartnerVault,
    sig: "setAuthorizedCaller(address,bool)",
    params: [
      { name: "caller", type: "address", placeholder: "0x..." },
      { name: "status", type: "bool", placeholder: "true", hint: "true or false" },
    ],
  },
  {
    label: "setIFRLock(address)",
    target: ADDRESSES.PartnerVault,
    sig: "setIFRLock(address)",
    params: [
      { name: "_ifrLock", type: "address", placeholder: ADDRESSES.IFRLock },
    ],
  },
  {
    label: "createPartner(bytes32, address, uint256, uint32, uint32, uint8)",
    target: ADDRESSES.PartnerVault,
    sig: "createPartner(bytes32,address,uint256,uint32,uint32,uint8)",
    params: [
      { name: "partnerId", type: "bytes32", placeholder: "0x...", hint: 'keccak256("partner-name")' },
      { name: "beneficiary", type: "address", placeholder: "0x..." },
      { name: "maxAllocation", type: "uint256", placeholder: "1000000000000000", hint: "Raw (9 dec). 1M = 1000000000000000" },
      { name: "vestingDuration", type: "uint32", placeholder: "15552000", hint: "Seconds. 180d = 15552000" },
      { name: "cliff", type: "uint32", placeholder: "2592000", hint: "Seconds. 30d = 2592000" },
      { name: "tier", type: "uint8", placeholder: "1", hint: "1-3" },
    ],
  },
  {
    label: "activatePartner(bytes32)",
    target: ADDRESSES.PartnerVault,
    sig: "activatePartner(bytes32)",
    params: [
      { name: "partnerId", type: "bytes32", placeholder: "0x..." },
    ],
  },
  {
    label: "recordMilestone(bytes32, bytes32, uint256)",
    target: ADDRESSES.PartnerVault,
    sig: "recordMilestone(bytes32,bytes32,uint256)",
    params: [
      { name: "partnerId", type: "bytes32", placeholder: "0x..." },
      { name: "milestoneId", type: "bytes32", placeholder: "0x...", hint: 'keccak256("milestone-1")' },
      { name: "unlockAmount", type: "uint256", placeholder: "100000000000000", hint: "Raw (9 dec). 100K = 100000000000000" },
    ],
  },
  // --- FeeRouter ---
  {
    label: "FeeRouter: setFeeBps(uint16)",
    target: ADDRESSES.FeeRouter,
    sig: "setFeeBps(uint16)",
    params: [
      { name: "newBps", type: "uint16", placeholder: "5", hint: "0-25 bps. Default 5 (0.05%). Cap 25 (0.25%)" },
    ],
  },
  {
    label: "FeeRouter: setAdapter(address, bool)",
    target: ADDRESSES.FeeRouter,
    sig: "setAdapter(address,bool)",
    params: [
      { name: "adapter", type: "address", placeholder: "0x..." },
      { name: "status", type: "bool", placeholder: "true", hint: "true = whitelist, false = remove" },
    ],
  },
  {
    label: "FeeRouter: setVoucherSigner(address)",
    target: ADDRESSES.FeeRouter,
    sig: "setVoucherSigner(address)",
    params: [
      { name: "newSigner", type: "address", placeholder: "0x..." },
    ],
  },
  {
    label: "FeeRouter: setPaused(bool)",
    target: ADDRESSES.FeeRouter,
    sig: "setPaused(bool)",
    params: [
      { name: "_paused", type: "bool", placeholder: "true", hint: "true = pause, false = unpause" },
    ],
  },
];

export default function CalldataGenerator() {
  const [selected, setSelected] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [result, setResult] = useState<{ calldata: string; cmd: string } | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  const fn = FUNCTIONS[selected];

  function handleSelect(idx: number) {
    setSelected(idx);
    setValues({});
    setResult(null);
    setError("");
  }

  function handleChange(name: string, val: string) {
    setValues((prev) => ({ ...prev, [name]: val }));
  }

  function generate() {
    setError("");
    setResult(null);
    try {
      const abi = fn.target === ADDRESSES.FeeRouter ? FeeRouterABI : PartnerVaultABI;
      const iface = new ethers.utils.Interface(abi);
      const args = fn.params.map((p) => {
        const raw = values[p.name]?.trim() || "";
        if (!raw) throw new Error(`Missing: ${p.name}`);
        if (p.type === "bool") return raw === "true";
        return raw;
      });
      const calldata = iface.encodeFunctionData(fn.sig.split("(")[0], args);

      const cmd = [
        `npx hardhat run scripts/execute-proposal.js --network sepolia`,
        `# Target: ${fn.target}`,
        `# Function: ${fn.label}`,
        `# Calldata: ${calldata}`,
        ``,
        `# Or create proposal manually:`,
        `# await governance.propose("${fn.target}", "${calldata}")`,
      ].join("\n");

      setResult({ calldata, cmd });
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : "Encoding failed");
    }
  }

  function copyToClipboard(text: string, label: string) {
    navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="space-y-6">
      {/* Function selector */}
      <div className="bg-ifr-card border border-ifr-border rounded-lg p-5">
        <label className="block text-xs text-ifr-muted mb-2 uppercase tracking-wide">Select Function</label>
        <select
          value={selected}
          onChange={(e) => handleSelect(Number(e.target.value))}
          className="w-full bg-ifr-input border border-ifr-border rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-ifr-accent"
        >
          {FUNCTIONS.map((f, i) => (
            <option key={i} value={i}>{f.label}</option>
          ))}
        </select>
      </div>

      {/* Parameters */}
      <div className="bg-ifr-card border border-ifr-border rounded-lg p-5 space-y-4">
        <h3 className="text-sm font-semibold text-gray-300">Parameters</h3>
        {fn.params.map((p) => (
          <div key={p.name}>
            <label className="block text-xs text-ifr-muted mb-1">
              {p.name} <span className="text-gray-500">({p.type})</span>
            </label>
            <input
              type="text"
              value={values[p.name] || ""}
              onChange={(e) => handleChange(p.name, e.target.value)}
              placeholder={p.placeholder}
              className="w-full bg-ifr-input border border-ifr-border rounded-lg px-3 py-2 text-sm text-gray-200 placeholder:text-gray-600 focus:outline-none focus:border-ifr-accent font-mono"
            />
            {p.hint && <div className="text-xs text-ifr-muted mt-1">{p.hint}</div>}
          </div>
        ))}
        <button
          onClick={generate}
          className="bg-ifr-accent hover:bg-ifr-accent-dim text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
        >
          Generate Calldata
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-ifr-red/10 border border-ifr-red/30 rounded-lg p-3 text-ifr-red text-sm">{error}</div>
      )}

      {/* Result */}
      {result && (
        <div className="bg-ifr-card border border-ifr-border rounded-lg p-5 space-y-4">
          <h3 className="text-sm font-semibold text-gray-300">Generated Output</h3>

          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-ifr-muted">Encoded Calldata</span>
              <button
                onClick={() => copyToClipboard(result.calldata, "calldata")}
                className="text-xs text-ifr-accent hover:text-ifr-accent-dim"
              >
                {copied === "calldata" ? "Copied!" : "Copy"}
              </button>
            </div>
            <code className="block bg-ifr-input rounded-lg p-3 text-xs text-gray-300 break-all font-mono">
              {result.calldata}
            </code>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-ifr-muted">Governance Proposal Command</span>
              <button
                onClick={() => copyToClipboard(result.cmd, "cmd")}
                className="text-xs text-ifr-accent hover:text-ifr-accent-dim"
              >
                {copied === "cmd" ? "Copied!" : "Copy"}
              </button>
            </div>
            <pre className="bg-ifr-input rounded-lg p-3 text-xs text-gray-300 overflow-x-auto font-mono whitespace-pre">
              {result.cmd}
            </pre>
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <span className="text-xs text-ifr-muted">Propose Call (JS)</span>
              <button
                onClick={() => copyToClipboard(`await governance.propose("${fn.target}", "${result.calldata}")`, "js")}
                className="text-xs text-ifr-accent hover:text-ifr-accent-dim"
              >
                {copied === "js" ? "Copied!" : "Copy"}
              </button>
            </div>
            <code className="block bg-ifr-input rounded-lg p-3 text-xs text-ifr-green break-all font-mono">
              await governance.propose("{fn.target}", "{result.calldata}")
            </code>
          </div>
        </div>
      )}
    </div>
  );
}
