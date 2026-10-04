# Exchange Address Verification Procedure

**Status:** adopted 2026-10-03 (project decision, Lane 5). It implements the transfer-fee exemption policy
for centralized exchanges approved by the Council on 2026-08-26.

No exchange address is exempt until every step below is complete and its own Governance proposal has been
executed.

## Scope

- An exempt address does not pay the IFR transfer fee (burn and pool fee) when sending or receiving IFR.
- An exemption is reversible: Governance can remove it with another proposal.
- Exchanges receive no IFR incentives and no governance role from this procedure. EX-01 and EX-02 are
  decided separately by Council vote.

## Steps per Exchange

1. **Request.** The exchange names every hot and cold wallet address that should be exempt, through its
   official listing or support channel.
2. **Domain confirmation.** The same list is confirmed by e-mail from the exchange's official domain.
   The message and its headers are archived.
3. **Signature per address.** From each address the exchange signs this text on
   <https://etherscan.io/verifiedSignatures> and publishes the signature:

   ```text
   IFR fee exemption request
   Exchange: <exchange name>
   Address: <address>
   Date: <YYYY-MM-DD>
   I control this address and request the IFR transfer-fee exemption for it.
   ```

   The signer is recovered independently (`ecrecover`) and must equal the address.

   This signature route proves control of externally owned accounts (EOAs) only. A smart-contract
   address (for example a multisig or ERC-1271 contract wallet) cannot be verified by EOA signature
   recovery and must never be recorded as verified this way. Control of such an address requires a
   separate supported proof; until one is defined and completed, the address does not pass this step.
4. **Test transfer.** Each address sends a small IFR amount to an address named by the project and
   receives a small amount back. Both transactions are recorded.
5. **Public record.** Exchange name, addresses, signature links, test transactions and date are added to
   the public vote log before any proposal.
6. **Governance proposal.** The Treasury Safe proposes `InfernoToken.setFeeExempt(<address>, true)` for each
   address. Execution follows after the 48-hour timelock.
7. **Review.** Exempt addresses are listed on the transparency page. An address that is no longer
   controlled by the exchange, or that is misused, is removed by a new proposal.

## Not Allowed

- Exemption for an address that has not passed steps 1 to 5.
- Exemption for personal wallets, market makers or intermediaries presented as exchange wallets.
- Bundling an exemption with any payment, loan or incentive.
