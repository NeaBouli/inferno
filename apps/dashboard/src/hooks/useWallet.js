import { useState, useEffect, useCallback } from "react";
import { ethers } from "ethers";
import { SEPOLIA_CHAIN_ID } from "../config/addresses";

export function useWallet() {
  const [account, setAccount] = useState(null);
  const [chainId, setChainId] = useState(null);
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);

  const updateState = useCallback(async () => {
    if (!window.ethereum) return;
    const p = new ethers.BrowserProvider(window.ethereum);
    const network = await p.getNetwork();
    setChainId(Number(network.chainId));
    setProvider(p);

    const accounts = await p.send("eth_accounts", []);
    if (accounts.length > 0) {
      setAccount(accounts[0]);
      setSigner(await p.getSigner(accounts[0]));
    }
  }, []);

  useEffect(() => {
    updateState();
    if (!window.ethereum) return;

    const handleAccountsChanged = async (accounts) => {
      setAccount(accounts[0] || null);
      if (accounts[0]) {
        const p = new ethers.BrowserProvider(window.ethereum);
        setSigner(await p.getSigner(accounts[0]));
        setProvider(p);
      } else {
        setSigner(null);
      }
    };

    const handleChainChanged = () => {
      window.location.reload();
    };

    window.ethereum.on("accountsChanged", handleAccountsChanged);
    window.ethereum.on("chainChanged", handleChainChanged);

    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccountsChanged);
      window.ethereum.removeListener("chainChanged", handleChainChanged);
    };
  }, [updateState]);

  const connect = useCallback(async () => {
    if (!window.ethereum) {
      alert("MetaMask not found. Please install MetaMask.");
      return;
    }
    await window.ethereum.request({ method: "eth_requestAccounts" });
    await updateState();
  }, [updateState]);

  const disconnect = useCallback(() => {
    setAccount(null);
    setSigner(null);
  }, []);

  const isCorrectNetwork = chainId === SEPOLIA_CHAIN_ID;

  const switchToSepolia = useCallback(async () => {
    if (!window.ethereum) return;
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: "0x" + SEPOLIA_CHAIN_ID.toString(16) }],
      });
    } catch (err) {
      console.error("Failed to switch network:", err);
    }
  }, []);

  return {
    account,
    chainId,
    provider,
    signer,
    connect,
    disconnect,
    isCorrectNetwork,
    switchToSepolia,
  };
}
