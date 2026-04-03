import { useAccount, useChainId } from "wagmi";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import TokenOverview from "./components/TokenOverview";
import ProtocolStats from "./components/ProtocolStats";
import Transfer from "./components/Transfer";
import LockPanel from "./components/LockPanel";
import Governance from "./components/Governance";
import Contracts from "./components/Contracts";
import { useEthersSigner } from "./hooks/useEthersSigner";
import { useContracts } from "./hooks/useContracts";
import { SEPOLIA_CHAIN_ID, MAINNET_CHAIN_ID } from "./config/addresses";

function getNetworkBadge(chainId) {
  if (chainId === SEPOLIA_CHAIN_ID) return { label: "Sepolia", className: "badge-sepolia" };
  if (chainId === MAINNET_CHAIN_ID) return { label: "Mainnet", className: "badge-mainnet" };
  if (chainId) return { label: "Wrong Network", className: "badge-wrong" };
  return { label: "Not Connected", className: "badge-disconnected" };
}

export default function App() {
  const { address: account } = useAccount();
  const chainId = useChainId();
  const signer = useEthersSigner();
  const contracts = useContracts(signer);

  const network = getNetworkBadge(chainId);

  return (
    <div className="app">
      <header className="header">
        <div className="header-left">
          <img src="/ifr_logo.png" alt="Inferno" className="logo" />
          <h1>Inferno Dashboard</h1>
        </div>
        <div className="header-right">
          <span className={`network-badge ${network.className}`}>
            {network.label}
          </span>
          <ConnectButton />
        </div>
      </header>
      <main className="main">
        <TokenOverview contracts={contracts} account={account} />
        <ProtocolStats contracts={contracts} />
        <Transfer contracts={contracts} account={account} signer={signer} />
        <LockPanel contracts={contracts} account={account} signer={signer} />
        <Governance contracts={contracts} account={account} signer={signer} />
        <Contracts />
      </main>
      <footer className="footer">
        Inferno ($IFR) &mdash; Community Fair Launch Model &mdash; Sepolia Testnet
      </footer>
    </div>
  );
}
