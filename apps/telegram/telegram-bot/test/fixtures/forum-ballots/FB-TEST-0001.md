# Sepolia test ballot FB-TEST-0001

Should the project exercise the Forum vote collector with this test proposal?

This is an offline example for the Sepolia test network. Its contract address,
snapshot block and block hash are synthetic fixtures, not chain evidence. It is
not a live ballot and cannot be used for an on-chain tally. No funds or governance
permissions are affected. Forum results are advisory; the Council decides.

Choose yes, no or abstain. A wallet's last valid signed vote counts; issuedAt
orders its votes and the collector's receipt order breaks exact ties. Abstain
counts towards quorum and is excluded from the yes/no result.
