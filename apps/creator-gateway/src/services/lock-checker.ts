import { ethers } from 'ethers';
import { CONFIG } from '../config';

const IFRLOCK_ABI = [
  'function isLocked(address wallet, uint256 minAmount) view returns (bool)',
  'function lockedBalance(address wallet) view returns (uint256)',
];

export class LockChecker {
  private provider: ethers.providers.JsonRpcProvider;
  private contract: ethers.Contract;

  constructor() {
    this.provider = new ethers.providers.JsonRpcProvider(CONFIG.rpcUrl);
    this.contract = new ethers.Contract(CONFIG.ifrLockAddress, IFRLOCK_ABI, this.provider);
  }

  async isLocked(walletAddress: string, minIFR: string = CONFIG.minLockIFR): Promise<boolean> {
    try {
      const minAmount = ethers.utils.parseUnits(minIFR, CONFIG.decimals);
      return await this.contract.isLocked(walletAddress, minAmount);
    } catch {
      return false; // fail-closed
    }
  }

  async lockedBalance(walletAddress: string): Promise<string> {
    try {
      const raw = await this.contract.lockedBalance(walletAddress);
      return ethers.utils.formatUnits(raw, CONFIG.decimals);
    } catch {
      return '0';
    }
  }
}

export const lockChecker = new LockChecker();
