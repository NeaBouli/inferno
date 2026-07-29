import hre from "hardhat";

export const connection = await hre.network.getOrCreate();
export const { ethers } = connection;
