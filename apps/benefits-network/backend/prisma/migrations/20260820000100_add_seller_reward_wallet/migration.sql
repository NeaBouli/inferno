-- Additive seller reward opt-in enhancement. A NULL rewardWallet keeps the
-- current behavior: the PartnerVault beneficiary must equal the business owner.
ALTER TABLE "SellerRewardLink" ADD COLUMN "rewardWallet" TEXT;
ALTER TABLE "SellerRewardLink" ADD COLUMN "rewardWalletConfirmedAt" DATETIME;
