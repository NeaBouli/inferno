import Header from "./components/Header";
import TokenOverview from "./components/TokenOverview";
import ProtocolStats from "./components/ProtocolStats";
import Transfer from "./components/Transfer";
import LockPanel from "./components/LockPanel";
import Governance from "./components/Governance";
import Contracts from "./components/Contracts";
import { useWallet } from "./hooks/useWallet";
import { useContracts } from "./hooks/useContracts";

export default function App() {
  const { account, chainId, signer, connect, disconnect, switchToSepolia } = useWallet();
  const contracts = useContracts(signer);

  return (
    <div className="app">
      <Header
        account={account}
        chainId={chainId}
        connect={connect}
        disconnect={disconnect}
        switchToSepolia={switchToSepolia}
      />
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
