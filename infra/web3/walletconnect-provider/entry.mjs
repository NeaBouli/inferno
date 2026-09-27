// Browser entry for the vendored WalletConnect provider artifact.
// The wallet runtime consumes `mod.EthereumProvider || mod.default`.
import { EthereumProvider } from "@walletconnect/ethereum-provider";

export { EthereumProvider };
export default EthereumProvider;
