'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi';
import QRCode from 'react-qr-code';
import { BusinessLogo } from '@/components/BusinessLogo';
import { SellerCatalogManager } from '@/components/SellerCatalogManager';
import { SellerRewardStatus } from '@/components/SellerRewardStatus';
import { useAvailableWalletConnectors } from '@/hooks/useAvailableWalletConnectors';
import {
  selectPreferredWalletConnector,
  walletConnectionErrorMessage,
  walletConnectorLabel,
} from '@/lib/walletConnectorSelection.mjs';
import {
  buildSellerSessionCsv,
  maskSellerSessionWallet,
  SELLER_SESSION_PAGE_LIMIT,
  sellerSessionCsvFilename,
} from '@/lib/sellerSessionExport';
import {
  AdminBusinessCreated,
  BenefitRule,
  BenefitRuleInput,
  CheckoutOperator,
  CatalogProduct,
  SellerAuth,
  SellerBusinessSummary,
  SellerActivityMetrics,
  SellerSessionSummary,
  claimSellerBusinessSlug,
  createAdminBusinessRule,
  createSellerBusiness,
  createSellerBusinessRule,
  createSellerCheckoutOperator,
  discoverOffers,
  deleteAdminBusinessRule,
  deleteSellerBusiness,
  deleteSellerBusinessRule,
  deleteSellerCheckoutOperator,
  getAdminBusinessRules,
  getAdminBusinessProfile,
  getBusiness,
  getBusinessRules,
  getSellerAuthMessage,
  getSellerBusinesses,
  getSellerBusinessRules,
  getSellerBusinessSessions,
  getSellerCheckoutOperators,
  updateAdminBusinessProfile,
  updateAdminBusinessRule,
  updateSellerBusinessProfile,
  updateSellerBusinessRule,
  type LockSource,
} from '@/lib/api';
import { formatProductPrice } from '@/lib/money';
import { formatIFR } from '@/lib/contracts';
import {
  isLockSource,
  lockSourceLabel,
  lockSourceRequirement,
  verifiedLockSourceLabel,
} from '@/lib/lockSource';
import {
  businessPublicReference,
  businessSlugError,
  normalizeBusinessSlug,
  parseBusinessReference,
  suggestBusinessSlug,
} from '@/lib/businessSlug';

const categories = ['Coffee', 'Retail', 'Digital access', 'Events', 'Services'];
const profileCategorySuggestions = [
  'Food & drink',
  'Retail',
  'Services',
  'Digital access',
  'Events',
  'Wellness',
  'Travel',
  'Education',
];
const ruleTemplates = [
  {
    name: 'Welcome benefit',
    detail: 'Low-friction first visit',
    label: 'Welcome',
    category: 'Retail',
    product: 'First visit benefit',
    discount: 5,
    minLocked: 500,
    minHeld: 0,
    dailyLimit: 1,
    monthlyLimit: 1,
    ttl: 90,
  },
  {
    name: 'Member standard',
    detail: 'Everyday repeat benefit',
    label: 'Member',
    category: 'Retail',
    product: 'Member discount',
    discount: 10,
    minLocked: 1000,
    minHeld: 0,
    dailyLimit: 1,
    monthlyLimit: 10,
    ttl: 90,
  },
  {
    name: 'Premium access',
    detail: 'Higher lock threshold',
    label: 'Premium',
    category: 'Services',
    product: 'Premium member access',
    discount: 15,
    minLocked: 5000,
    minHeld: 0,
    dailyLimit: 1,
    monthlyLimit: 4,
    ttl: 120,
  },
  {
    name: 'Event pass',
    detail: 'Single-use monthly offer',
    label: 'Event pass',
    category: 'Events',
    product: 'Event member benefit',
    discount: 20,
    minLocked: 10000,
    minHeld: 0,
    dailyLimit: 1,
    monthlyLimit: 1,
    ttl: 120,
  },
] as const;
const LAST_BUSINESS_STORAGE_KEY = 'ifr.shop.lastSellerBusinessId';
const SHOP_ORIGIN = 'https://shop.ifrunit.tech';
const DEFAULT_RULE_DRAFT = {
  category: categories[0],
  product: 'Premium customer discount',
  label: 'Bronze',
  discount: 10,
  minLocked: 1000,
  minHeld: 0,
  lockSource: 'ifrlock' as const,
  dailyLimit: 1,
  monthlyLimit: 10,
  ttl: 90,
};

function formatSessionLockedIFR(value: string | null) {
  if (!value) return null;

  const [whole = '0', fraction = ''] = value.split('.');
  if (!/^\d+$/.test(whole) || (fraction && !/^\d+$/.test(fraction))) return null;
  const groupedWhole = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const trimmedFraction = fraction.replace(/0+$/, '').slice(0, 3);

  return trimmedFraction ? `${groupedWhole}.${trimmedFraction}` : groupedWhole;
}

function formatSessionHeldIFR(value: string | null) {
  if (!value || !/^\d+$/.test(value)) return null;

  try {
    return formatIFR(BigInt(value));
  } catch {
    return null;
  }
}

export function SellerRuleBuilder() {
  const { address, isConnected } = useAccount();
  const { connectors, connectAsync, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { signMessageAsync } = useSignMessage();
  const { availableConnectors } = useAvailableWalletConnectors(connectors);
  const [businessId, setBusinessId] = useState('');
  const [businessSlugDraft, setBusinessSlugDraft] = useState('ifr-partner-shop');
  const [adminSecret, setAdminSecret] = useState('');
  const [businessName, setBusinessName] = useState('IFR Partner Shop');
  const [businessDescription, setBusinessDescription] = useState('');
  const [businessWebsite, setBusinessWebsite] = useState('');
  const [businessLogoUrl, setBusinessLogoUrl] = useState('');
  const [businessServiceArea, setBusinessServiceArea] = useState('');
  const [serviceAreaDisclosureConfirmed, setServiceAreaDisclosureConfirmed] = useState(false);
  const [businessCategories, setBusinessCategories] = useState<string[]>([]);
  const [profileCategoryDraft, setProfileCategoryDraft] = useState('');
  const [defaultTier, setDefaultTier] = useState('IFR Access');
  const [category, setCategory] = useState(DEFAULT_RULE_DRAFT.category);
  const [product, setProduct] = useState(DEFAULT_RULE_DRAFT.product);
  const [label, setLabel] = useState(DEFAULT_RULE_DRAFT.label);
  const [discount, setDiscount] = useState(DEFAULT_RULE_DRAFT.discount);
  const [minLocked, setMinLocked] = useState(DEFAULT_RULE_DRAFT.minLocked);
  const [minHeld, setMinHeld] = useState(DEFAULT_RULE_DRAFT.minHeld);
  const [lockSource, setLockSource] = useState<LockSource>(DEFAULT_RULE_DRAFT.lockSource);
  const [dailyLimit, setDailyLimit] = useState(DEFAULT_RULE_DRAFT.dailyLimit);
  const [monthlyLimit, setMonthlyLimit] = useState(DEFAULT_RULE_DRAFT.monthlyLimit);
  const [ttl, setTtl] = useState(DEFAULT_RULE_DRAFT.ttl);
  const [rules, setRules] = useState<BenefitRule[]>([]);
  const [catalogProducts, setCatalogProducts] = useState<CatalogProduct[]>([]);
  const [selectedProductId, setSelectedProductId] = useState('');
  const [editingRuleId, setEditingRuleId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SellerSessionSummary[]>([]);
  const [activityMetrics, setActivityMetrics] = useState<SellerActivityMetrics | null>(null);
  const [sessionNextCursor, setSessionNextCursor] = useState<string | null>(null);
  const [sessionHasMore, setSessionHasMore] = useState(false);
  const [sessionSnapshot, setSessionSnapshot] = useState<string | null>(null);
  const [sessionHistoryBinding, setSessionHistoryBinding] = useState<{
    walletAddress: string;
    businessId: string;
  } | null>(null);
  const [checkoutOperators, setCheckoutOperators] = useState<CheckoutOperator[]>([]);
  const [operatorWallet, setOperatorWallet] = useState('');
  const [operatorLabel, setOperatorLabel] = useState('Front counter');
  const [operatorDuration, setOperatorDuration] = useState<'shift' | 'week' | 'month' | 'never'>('shift');
  const [sellerBusinesses, setSellerBusinesses] = useState<SellerBusinessSummary[]>([]);
  const [createdBusiness, setCreatedBusiness] = useState<AdminBusinessCreated | null>(null);
  const [restoreInput, setRestoreInput] = useState('');
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [verifyingPublicListing, setVerifyingPublicListing] = useState(false);
  const [publicListing, setPublicListing] = useState<{
    businessId: string;
    offerCount: number;
    expectedRuleVisible: boolean;
    checkedAt: string;
    error: string;
  } | null>(null);
  const activeBusinessIdRef = useRef(businessId);
  const activeWalletAddressRef = useRef('');

  function setActiveBusinessId(nextBusinessId: string) {
    activeBusinessIdRef.current = nextBusinessId;
    setBusinessId(nextBusinessId);
  }

  const canUseWalletOwner = Boolean(address && isConnected);
  const normalizedWalletAddress = canUseWalletOwner && address ? address.toLowerCase() : '';
  activeWalletAddressRef.current = normalizedWalletAddress;
  const canUseOperatorFallback = Boolean(adminSecret);
  const canManage = canUseWalletOwner || canUseOperatorFallback;
  const activeRulesCount = rules.filter((rule) => rule.active).length;
  const activeCatalogCount = catalogProducts.filter((item) => item.active).length;
  const editingRule = rules.find((rule) => rule.id === editingRuleId) || null;
  const selectedBusiness = sellerBusinesses.find((business) => business.id === businessId) || null;
  const publicBusinessRef = selectedBusiness
    ? businessPublicReference(selectedBusiness)
    : businessId;
  const scannerUrl = publicBusinessRef ? `${SHOP_ORIGIN}/b/${publicBusinessRef}` : '';
  const catalogUrl = publicBusinessRef ? `${SHOP_ORIGIN}/s/${publicBusinessRef}` : '';
  const selectedBusinessUsesWalletOwner = Boolean(selectedBusiness?.ownerAddress);
  const selectedBusinessOwnerMatchesWallet = Boolean(
    selectedBusiness?.ownerAddress &&
    normalizedWalletAddress &&
    selectedBusiness.ownerAddress.toLowerCase() === normalizedWalletAddress
  );
  const profileNeedsLoading = Boolean(businessId && !selectedBusiness);
  const canEditSelectedProfile = Boolean(selectedBusiness) && (
    selectedBusinessUsesWalletOwner ? selectedBusinessOwnerMatchesWallet : canUseOperatorFallback
  );
  const canManageSelectedBusiness = selectedBusiness ? canEditSelectedProfile : canManage;
  const businessReady = Boolean(businessId);
  const profileReady = Boolean(selectedBusiness);
  const walletOwnedProfileReady = selectedBusinessOwnerMatchesWallet;
  const publicProfileDetailsReady = Boolean(
    selectedBusiness?.description && selectedBusiness.serviceArea && selectedBusiness.categories.length > 0
  );
  const ruleReady = activeRulesCount > 0;
  const publicListingReady = Boolean(
    publicListing &&
    publicListing.businessId === businessId &&
    publicListing.offerCount > 0 &&
    publicListing.expectedRuleVisible &&
    !publicListing.error
  );
  const scannerReady = Boolean(scannerUrl && ruleReady);
  const sessionHistoryIsCurrent = Boolean(
    sessionHistoryBinding &&
    sessionHistoryBinding.walletAddress === normalizedWalletAddress &&
    sessionHistoryBinding.businessId === businessId
  );
  const visibleSessions = sessionHistoryIsCurrent ? sessions : [];
  const visibleActivityMetrics = sessionHistoryIsCurrent ? activityMetrics : null;
  const sellerStatus = !canManage
    ? 'Connect seller wallet'
    : profileNeedsLoading
      ? 'Load seller profile'
    : !businessReady
      ? canUseWalletOwner ? 'Create seller profile' : 'Connect seller wallet'
      : profileReady && selectedBusinessUsesWalletOwner && !selectedBusinessOwnerMatchesWallet
        ? 'Connect profile owner wallet'
      : profileReady && !selectedBusinessUsesWalletOwner
        ? 'Owner wallet required for checkout'
      : !ruleReady && activeCatalogCount === 0
        ? 'Add first product or service'
      : !ruleReady
        ? 'Publish first benefit rule'
        : !publicListingReady
          ? 'Verify public offer'
          : 'Public offer live';
  const nextSellerStep = !canManage
    ? 'Connect the seller wallet, then load or create a wallet-owned seller profile.'
    : profileNeedsLoading
      ? 'Load the existing Business ID with its owner wallet or the controlled operator fallback.'
    : !businessReady
      ? canUseWalletOwner
        ? 'Create a seller profile or load an existing profile owned by this wallet.'
        : 'Connect a seller wallet to create a checkout-capable profile.'
      : profileReady && selectedBusinessUsesWalletOwner && !selectedBusinessOwnerMatchesWallet
        ? 'Switch to the wallet that owns this seller profile before editing rules or opening checkout.'
      : profileReady && !selectedBusinessUsesWalletOwner
        ? 'This operator-created profile cannot authorize checkout. Create or load a wallet-owned seller profile before publishing offers.'
      : !ruleReady && activeCatalogCount === 0
        ? 'Add the first customer-facing product or service. It will be selected automatically for the benefit rule.'
      : !ruleReady
        ? 'Review the selected product, benefit threshold and limits, then save the active rule.'
        : !publicListingReady
          ? 'Run the public check to prove this exact seller offer appears in customer discovery.'
          : 'Open the scanner at checkout, create a QR session, and redeem approved benefits once.';
  const sellerReadinessSteps = [
    { label: 'Wallet-owned seller profile', ready: walletOwnedProfileReady },
    { label: 'Seller profile selected', ready: profileReady },
    { label: 'Readable permanent seller URL', ready: Boolean(selectedBusiness?.slug), optional: true },
    { label: 'Public profile details filled', ready: publicProfileDetailsReady, optional: true },
    { label: 'Catalog item linked', ready: activeCatalogCount > 0, optional: true },
    { label: 'Active benefit rule loaded', ready: ruleReady },
    { label: 'Public offer verified', ready: publicListingReady },
  ];
  const launchChecksReady = [walletOwnedProfileReady, profileReady, ruleReady, publicListingReady].filter(Boolean).length;
  const sellerTasks = [
    { href: '#seller-launch', label: 'Launch', ready: launchChecksReady === 4 },
    { href: '#seller-profile', label: 'Profile', ready: profileReady },
    ...(profileReady ? [
      { href: '#seller-catalog', label: 'Products', ready: activeCatalogCount > 0 },
      { href: '#seller-rule-editor', label: 'Rules', ready: ruleReady },
      ...(businessId ? [{ href: '#seller-team', label: 'Team' }] : []),
      { href: '#seller-session-history', label: 'History' },
      { href: '#seller-rewards', label: 'Rewards' },
    ] : []),
  ];
  const checkoutKitText = useMemo(
    () => [
      `${businessName || 'IFR Partner Shop'} IFR checkout kit`,
      `Scanner: ${scannerUrl || 'Create or select a seller profile first.'}`,
      `Available in: ${businessServiceArea.trim() || 'not published'}`,
      `Default benefit: ${discount}% off when ${minLocked.toLocaleString('en-US')} IFR is locked ${lockSourceRequirement(lockSource)}`,
      ...(minHeld > 0 ? [`Free wallet balance: ${minHeld.toLocaleString('en-US')} IFR`] : []),
      `Wallet limit: ${dailyLimit || 'unlimited'}/day / ${monthlyLimit || 'unlimited'}/month (UTC)`,
      `Rule draft: ${label || 'IFR Benefit'} / ${category} / ${product || 'IFR Benefit'}`,
      'At checkout: open scanner, create QR session, let the customer scan and sign, then redeem only after APPROVED.',
    ].join('\n'),
    [businessName, businessServiceArea, category, dailyLimit, discount, label, lockSource, minHeld, minLocked, monthlyLimit, product, scannerUrl]
  );
  const sellerBackupText = useMemo(() => JSON.stringify(
    {
      app: 'IFR Benefits Network',
      version: 2,
      exportedAt: new Date().toISOString(),
      businessId: businessId || null,
      sellerSlug: selectedBusiness?.slug || null,
      scannerUrl: scannerUrl || null,
      catalogUrl: catalogUrl || null,
      sellerName: selectedBusiness?.name || businessName || 'IFR Partner Shop',
      sellerDescription: selectedBusiness?.description || businessDescription || null,
      sellerWebsite: selectedBusiness?.website || businessWebsite || null,
      sellerLogoUrl: selectedBusiness?.logoUrl || businessLogoUrl || null,
      sellerServiceArea: selectedBusiness?.serviceArea || businessServiceArea || null,
      sellerCategories: selectedBusiness?.categories || businessCategories,
      ownerAddress: selectedBusiness?.ownerAddress || address || null,
      defaultBenefit: {
        label: label || 'IFR Benefit',
        category,
        productName: product || 'IFR Benefit',
        discountPercent: discount,
        requiredLockIFR: minLocked,
        minIFRHeld: minHeld,
        lockSource,
        dailyRedemptionLimit: dailyLimit,
        monthlyRedemptionLimit: monthlyLimit,
        ttlSeconds: ttl,
      },
      activeRulesLoaded: activeRulesCount,
      note: 'Public seller handoff only. No admin secret, private key, seed phrase or wallet signature is included.',
    },
    null,
    2
  ), [activeRulesCount, address, businessCategories, businessDescription, businessId, businessLogoUrl, businessName, businessServiceArea, businessWebsite, catalogUrl, category, dailyLimit, discount, label, lockSource, minHeld, minLocked, monthlyLimit, product, scannerUrl, selectedBusiness, ttl]);

  function getCustomerProofUrl(sessionId: string) {
    return `${SHOP_ORIGIN}/r/${sessionId}`;
  }

  function getSessionRestoreReceipt(session: SellerSessionSummary) {
    const lockedIFR = formatSessionLockedIFR(session.lockAmountRaw);
    const heldIFR = formatSessionHeldIFR(session.walletBalanceRaw);

    return [
      'IFR Benefits Network session restore receipt',
      `Seller: ${selectedBusiness?.name || businessName || businessId || 'IFR Partner Shop'}`,
      `Session: ${session.id}`,
      `Status: ${session.status}`,
      `Benefit: ${session.discountPercent}%`,
      `Required lock: ${session.requiredLockIFR.toLocaleString('en-US')} IFR`,
      `Accepted source: ${lockSourceLabel(session.lockSource)}`,
      ...(session.minIFRHeld > 0
        ? [`Required held: ${session.minIFRHeld.toLocaleString('en-US')} IFR`]
        : []),
      `Rule: ${session.label || 'Business default'}`,
      `Product: ${session.productName || 'Business default benefit'}`,
      ...(formatProductPrice(session.basePriceMinor, session.currency)
        ? [`Reference price: ${formatProductPrice(session.basePriceMinor, session.currency)}`]
        : []),
      `Customer wallet: ${session.recoveredAddress || 'not verified yet'}`,
      `Locked: ${lockedIFR ? `${lockedIFR} IFR` : 'not verified yet'}`,
      `Verified source: ${verifiedLockSourceLabel(session.verifiedLockSource)}`,
      ...(session.verificationBlock ? [`Verification block: ${session.verificationBlock}`] : []),
      ...(session.minIFRHeld > 0
        ? [`Held at verification: ${heldIFR ? `${heldIFR} IFR` : 'not verified yet'}`]
        : []),
      `Expires: ${session.expiresAt}`,
      `Redeemed: ${session.redeemedAt || 'not redeemed'}`,
      `Customer link: ${getCustomerProofUrl(session.id)}`,
      'Paste this receipt into the seller scanner Session recovery field to reopen the checkout.',
    ].join('\n');
  }

  useEffect(() => {
    try {
      const lastBusinessId = window.localStorage.getItem(LAST_BUSINESS_STORAGE_KEY);
      if (lastBusinessId) setActiveBusinessId(lastBusinessId);
    } catch {
      // Local storage can be unavailable in private modes; the manual field still works.
    }
  }, []);

  useEffect(() => {
    if (!businessId) return;
    try {
      window.localStorage.setItem(LAST_BUSINESS_STORAGE_KEY, businessId);
    } catch {
      // Ignore storage failures; this is only a convenience cache.
    }
  }, [businessId]);

  useEffect(() => {
    setEditingRuleId(null);
    setCheckoutOperators([]);
    setCatalogProducts([]);
    setSessions([]);
    setActivityMetrics(null);
    setSessionNextCursor(null);
    setSessionHasMore(false);
    setSessionSnapshot(null);
    setSessionHistoryBinding(null);
    setVerifyingPublicListing(false);
    setPublicListing(null);
    resetRuleDraft();
  }, [businessId]);

  useEffect(() => {
    setSessions([]);
    setActivityMetrics(null);
    setSessionNextCursor(null);
    setSessionHasMore(false);
    setSessionSnapshot(null);
    setSessionHistoryBinding(null);
  }, [normalizedWalletAddress]);

  const payload: BenefitRuleInput = useMemo(
    () => ({
      label: label || 'IFR Benefit',
      productId: selectedProductId || null,
      category,
      productName: product || 'IFR Benefit',
      discountPercent: discount,
      requiredLockIFR: minLocked,
      minIFRHeld: minHeld,
      lockSource,
      dailyRedemptionLimit: dailyLimit,
      monthlyRedemptionLimit: monthlyLimit,
      ttlSeconds: ttl,
      active: true,
    }),
    [category, dailyLimit, discount, label, lockSource, minHeld, minLocked, monthlyLimit, product, selectedProductId, ttl]
  );

  function resetRuleDraft() {
    setCategory(DEFAULT_RULE_DRAFT.category);
    setProduct(DEFAULT_RULE_DRAFT.product);
    setLabel(DEFAULT_RULE_DRAFT.label);
    setDiscount(DEFAULT_RULE_DRAFT.discount);
    setMinLocked(DEFAULT_RULE_DRAFT.minLocked);
    setMinHeld(DEFAULT_RULE_DRAFT.minHeld);
    setLockSource(DEFAULT_RULE_DRAFT.lockSource);
    setDailyLimit(DEFAULT_RULE_DRAFT.dailyLimit);
    setMonthlyLimit(DEFAULT_RULE_DRAFT.monthlyLimit);
    setTtl(DEFAULT_RULE_DRAFT.ttl);
    setSelectedProductId('');
  }

  function applyRuleTemplate(template: (typeof ruleTemplates)[number]) {
    setLabel(template.label);
    setDiscount(template.discount);
    setMinLocked(template.minLocked);
    setMinHeld(template.minHeld);
    setLockSource(DEFAULT_RULE_DRAFT.lockSource);
    setDailyLimit(template.dailyLimit);
    setMonthlyLimit(template.monthlyLimit);
    setTtl(template.ttl);
    if (!selectedProductId) {
      setCategory(template.category);
      setProduct(template.product);
    }
    setError('');
    setStatus(`${template.name} applied to the draft. Review the values before saving.`);
  }

  function setBusinessProfileDraft(business: SellerBusinessSummary) {
    setBusinessName(business.name);
    setBusinessSlugDraft(business.slug || suggestBusinessSlug(business.name));
    setBusinessDescription(business.description || '');
    setBusinessWebsite(business.website || '');
    setBusinessLogoUrl(business.logoUrl || '');
    setBusinessServiceArea(business.serviceArea || '');
    setServiceAreaDisclosureConfirmed(Boolean(business.serviceArea));
    setBusinessCategories(business.categories);
    setProfileCategoryDraft('');
  }

  function selectSellerBusiness(business: SellerBusinessSummary, announce = true) {
    setActiveBusinessId(business.id);
    setBusinessProfileDraft(business);
    setRules([]);
    setSessions([]);
    setActivityMetrics(null);
    setPublicListing(null);
    if (announce) {
      setStatus(`${business.name} selected. Load rules when you need the current list.`);
    }
  }

  function startNewSellerProfile() {
    setActiveBusinessId('');
    setBusinessName('IFR Partner Shop');
    setBusinessSlugDraft('ifr-partner-shop');
    setBusinessDescription('');
    setBusinessWebsite('');
    setBusinessLogoUrl('');
    setBusinessServiceArea('');
    setServiceAreaDisclosureConfirmed(false);
    setBusinessCategories([]);
    setProfileCategoryDraft('');
    setCreatedBusiness(null);
    setRules([]);
    setSessions([]);
    setActivityMetrics(null);
    setPublicListing(null);
    setStatus('New seller profile draft started.');
    setError('');
  }

  function updateBusinessName(nextName: string) {
    if (
      !selectedBusiness &&
      businessSlugDraft === suggestBusinessSlug(businessName)
    ) {
      setBusinessSlugDraft(suggestBusinessSlug(nextName));
    }
    setBusinessName(nextName);
  }

  function addBusinessCategory(rawCategory: string) {
    const nextCategory = rawCategory.trim();
    if (!nextCategory) return;
    if (nextCategory.length > 80) {
      setError('Business categories can contain at most 80 characters.');
      return;
    }
    if (businessCategories.some((item) => item.toLocaleLowerCase('en-US') === nextCategory.toLocaleLowerCase('en-US'))) {
      setProfileCategoryDraft('');
      return;
    }
    if (businessCategories.length >= 8) {
      setError('Choose up to 8 business categories.');
      return;
    }
    setBusinessCategories((current) => [...current, nextCategory]);
    setProfileCategoryDraft('');
    setError('');
  }

  function toggleBusinessCategory(profileCategory: string) {
    const selected = businessCategories.some(
      (item) => item.toLocaleLowerCase('en-US') === profileCategory.toLocaleLowerCase('en-US')
    );
    if (selected) {
      setBusinessCategories((current) => current.filter(
        (item) => item.toLocaleLowerCase('en-US') !== profileCategory.toLocaleLowerCase('en-US')
      ));
      return;
    }
    addBusinessCategory(profileCategory);
  }

  async function createBusiness() {
    if (!canUseWalletOwner) {
      setError('Connect the seller wallet before creating a checkout-capable seller profile.');
      return;
    }
    if (businessServiceArea.trim() && !serviceAreaDisclosureConfirmed) {
      setError('Confirm that the service-area text is public and contains no private address.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const slug = normalizeBusinessSlug(businessSlugDraft || businessName);
      const slugValidationError = businessSlugError(slug);
      if (slugValidationError) throw new Error(slugValidationError);
      const input = {
        name: businessName.trim() || 'IFR Partner Shop',
        slug,
        description: businessDescription.trim() || null,
        website: businessWebsite.trim() || null,
        logoUrl: businessLogoUrl.trim() || null,
        serviceArea: businessServiceArea.trim() || null,
        categories: businessCategories,
        discountPercent: discount,
        requiredLockIFR: minLocked,
        ttlSeconds: ttl,
        tierLabel: defaultTier || undefined,
      };
      const business = await createSellerBusiness(
        await signSellerAction('business:create', 'new', slug),
        input
      );
      setCreatedBusiness(business);
      setActiveBusinessId(business.id);
      setBusinessSlugDraft(business.slug || slug);
      setRules([]);
      setSessions([]);
      setActivityMetrics(null);
      setPublicListing(null);
      setSellerBusinesses((current) => [
        {
          id: business.id,
          slug: business.slug,
          ownerAddress: business.ownerAddress,
          verifyUrl: business.verifyUrl,
          qrUrl: business.qrUrl,
          name: input.name,
          description: input.description,
          website: input.website,
          logoUrl: input.logoUrl,
          serviceArea: input.serviceArea,
          categories: input.categories,
          discountPercent: input.discountPercent,
          requiredLockIFR: input.requiredLockIFR,
          tierLabel: input.tierLabel || null,
          createdAt: new Date().toISOString(),
          rulesCount: 0,
          productsCount: 0,
        },
        ...current.filter((item) => item.id !== business.id),
      ]);
      setStatus('Seller profile created and bound to your wallet. Next: add the first product or service.');
      window.requestAnimationFrame(() => {
        document.getElementById('seller-catalog')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create seller profile');
    } finally {
      setLoading(false);
    }
  }

  async function claimSellerSlug() {
    if (!selectedBusiness || !selectedBusinessUsesWalletOwner || !selectedBusinessOwnerMatchesWallet) {
      setError('Connect the profile owner wallet before claiming its permanent seller URL.');
      return;
    }
    if (selectedBusiness.slug) {
      setStatus(`Permanent seller URL is already ${SHOP_ORIGIN}/s/${selectedBusiness.slug}.`);
      return;
    }
    const slug = normalizeBusinessSlug(businessSlugDraft);
    const slugValidationError = businessSlugError(slug);
    if (slugValidationError) {
      setError(slugValidationError);
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const claimed = await claimSellerBusinessSlug(
        selectedBusiness.id,
        await signSellerAction('business:slug', selectedBusiness.id, slug),
        slug
      );
      setSellerBusinesses((current) => current.map((business) => (
        business.id === selectedBusiness.id ? { ...business, slug: claimed.slug } : business
      )));
      setBusinessSlugDraft(claimed.slug);
      setStatus(`Permanent seller URL claimed: ${SHOP_ORIGIN}${claimed.catalogUrl}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not claim seller URL');
    } finally {
      setLoading(false);
    }
  }

  async function saveSellerProfile() {
    if (!selectedBusiness || !canEditSelectedProfile) {
      setError(selectedBusinessUsesWalletOwner
        ? 'Connect the profile owner wallet before saving public details.'
        : 'Enter the operator admin fallback before saving this profile.'
      );
      return;
    }
    if (businessServiceArea.trim() && !serviceAreaDisclosureConfirmed) {
      setError('Confirm that the service-area text is public and contains no private address.');
      return;
    }
    const name = businessName.trim();
    if (!name) {
      setError('Seller name is required.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const targetBusinessId = selectedBusiness.id;
      const profileInput = {
        name,
        description: businessDescription.trim() || null,
        website: businessWebsite.trim() || null,
        logoUrl: businessLogoUrl.trim() || null,
        serviceArea: businessServiceArea.trim() || null,
        categories: businessCategories,
      };
      const updated = selectedBusinessUsesWalletOwner
        ? await updateSellerBusinessProfile(
            targetBusinessId,
            await signSellerAction('business:update', targetBusinessId, targetBusinessId),
            profileInput
          )
        : await updateAdminBusinessProfile(targetBusinessId, adminSecret, profileInput);
      setSellerBusinesses((current) => current.map((business) => (
        business.id === targetBusinessId ? { ...business, ...updated } : business
      )));
      if (activeBusinessIdRef.current === targetBusinessId) {
        setBusinessName(updated.name);
        setBusinessDescription(updated.description || '');
        setBusinessWebsite(updated.website || '');
        setBusinessLogoUrl(updated.logoUrl || '');
        setBusinessServiceArea(updated.serviceArea || '');
        setServiceAreaDisclosureConfirmed(Boolean(updated.serviceArea));
        setBusinessCategories(updated.categories);
        setStatus('Public seller profile saved. The catalog and offer search now use these details.');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save seller profile');
    } finally {
      setLoading(false);
    }
  }

  async function loadRules() {
    if (!businessId || !canManageSelectedBusiness) {
      setError('Business ID plus seller wallet or admin secret are required.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    const targetBusinessId = businessId;
    try {
      const result = canUseWalletOwner
        ? await getSellerBusinessRules(targetBusinessId, await signSellerAction('rules:list', targetBusinessId))
        : await getAdminBusinessRules(targetBusinessId, adminSecret);
      if (activeBusinessIdRef.current !== targetBusinessId) {
        setStatus('Seller context changed. Load rules again for the selected profile.');
        return;
      }
      setRules(result.rules);
      setEditingRuleId((current) => current && result.rules.some((rule) => rule.id === current) ? current : null);
      const publicOfferVisible = result.rules.some((rule) => rule.active)
        ? await verifyPublicListing(undefined, false)
        : false;
      setStatus(
        `Loaded ${result.rules.length} rule${result.rules.length === 1 ? '' : 's'}.` +
        (publicOfferVisible ? ' Public discovery is verified.' : '')
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load rules');
    } finally {
      setLoading(false);
    }
  }

  async function verifyPublicListing(expectedRuleId?: string, announce = true) {
    const targetBusinessId = activeBusinessIdRef.current.trim();
    if (!targetBusinessId) {
      if (announce) setError('Select a seller profile before verifying its public offer.');
      return false;
    }

    setVerifyingPublicListing(true);
    if (announce) {
      setError('');
      setStatus('Checking this seller profile in public customer discovery...');
    }
    try {
      const [result, publicRules] = await Promise.all([
        discoverOffers({ businessId: targetBusinessId, page: 1, limit: 24 }),
        getBusinessRules(targetBusinessId),
      ]);
      if (activeBusinessIdRef.current !== targetBusinessId) return false;
      const exactOffers = result.offers.filter((offer) => offer.business.id === targetBusinessId);
      const expectedRuleVisible = expectedRuleId
        ? publicRules.rules.some((rule) => rule.id === expectedRuleId)
        : result.pagination.total > 0 && exactOffers.length > 0;
      setPublicListing({
        businessId: targetBusinessId,
        offerCount: result.pagination.total,
        expectedRuleVisible,
        checkedAt: new Date().toISOString(),
        error: '',
      });
      if (announce) {
        setStatus(expectedRuleVisible
          ? `${exactOffers.length} public offer${exactOffers.length === 1 ? '' : 's'} verified for this seller.`
          : 'No active public offer was found for this seller. Activate a rule, then verify again.'
        );
      }
      return expectedRuleVisible;
    } catch (err) {
      if (activeBusinessIdRef.current !== targetBusinessId) return false;
      const message = err instanceof Error ? err.message : 'Public discovery is unavailable';
      setPublicListing({
        businessId: targetBusinessId,
        offerCount: 0,
        expectedRuleVisible: false,
        checkedAt: new Date().toISOString(),
        error: message,
      });
      if (announce) setError(`Public listing check failed: ${message}`);
      return false;
    } finally {
      if (activeBusinessIdRef.current === targetBusinessId) setVerifyingPublicListing(false);
    }
  }

  async function loadSessions() {
    if (!businessId || !canUseWalletOwner || !normalizedWalletAddress) {
      setError('Business ID plus seller wallet are required to load session history.');
      return;
    }
    const requestBusinessId = businessId;
    const requestWalletAddress = normalizedWalletAddress;
    setLoading(true);
    setSessions([]);
    setActivityMetrics(null);
    setSessionNextCursor(null);
    setSessionHasMore(false);
    setSessionSnapshot(null);
    setSessionHistoryBinding(null);
    setError('');
    setStatus('');
    try {
      const result = await getSellerBusinessSessions(
        requestBusinessId,
        await signSellerAction('sessions:list', requestBusinessId),
        SELLER_SESSION_PAGE_LIMIT
      );
      if (
        activeBusinessIdRef.current !== requestBusinessId ||
        activeWalletAddressRef.current !== requestWalletAddress
      ) {
        setStatus('Seller context changed. Load recent sessions again with the current owner wallet.');
        return;
      }
      setSessions(result.sessions);
      setActivityMetrics(result.metrics);
      setSessionNextCursor(result.pagination.nextCursor);
      setSessionHasMore(result.pagination.hasMore);
      setSessionSnapshot(result.pagination.snapshot);
      setSessionHistoryBinding({
        walletAddress: requestWalletAddress,
        businessId: requestBusinessId,
      });
      setStatus(`Loaded ${result.sessions.length} recent session${result.sessions.length === 1 ? '' : 's'} and seller activity.`);
    } catch (err) {
      if (
        activeBusinessIdRef.current === requestBusinessId &&
        activeWalletAddressRef.current === requestWalletAddress
      ) {
        setError(err instanceof Error ? err.message : 'Failed to load session history');
      }
    } finally {
      setLoading(false);
    }
  }

  async function loadOlderSessions() {
    if (!sessionHistoryIsCurrent || !sessionNextCursor || !sessionHasMore || !sessionSnapshot) {
      setError('Load the recent seller history before requesting older sessions.');
      return;
    }
    const requestBusinessId = businessId;
    const requestWalletAddress = normalizedWalletAddress;
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const result = await getSellerBusinessSessions(
        requestBusinessId,
        await signSellerAction('sessions:list', requestBusinessId),
        SELLER_SESSION_PAGE_LIMIT,
        sessionNextCursor,
        sessionSnapshot
      );
      if (
        activeBusinessIdRef.current !== requestBusinessId ||
        activeWalletAddressRef.current !== requestWalletAddress
      ) {
        setStatus('Seller context changed. Load session history again with the current owner wallet.');
        return;
      }
      setSessions((current) => {
        const known = new Set(current.map((session) => session.id));
        return [...current, ...result.sessions.filter((session) => !known.has(session.id))];
      });
      setSessionNextCursor(result.pagination.nextCursor);
      setSessionHasMore(result.pagination.hasMore);
      setStatus(`Loaded ${result.sessions.length} older session${result.sessions.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load older session history');
    } finally {
      setLoading(false);
    }
  }

  function saveSessionCsv(sellerName: string, exportSessions: SellerSessionSummary[]) {
    const csv = buildSellerSessionCsv(sellerName, exportSessions);
    const url = URL.createObjectURL(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = sellerSessionCsvFilename(sellerName);
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function downloadSessionCsv() {
    if (!businessId || !canUseWalletOwner || !normalizedWalletAddress) {
      setError('Connect the seller owner wallet before exporting session history.');
      return;
    }
    const requestBusinessId = businessId;
    const requestWalletAddress = normalizedWalletAddress;
    setLoading(true);
    setError('');
    setStatus('Preparing the masked full history export...');
    try {
      let auth = await signSellerAction('sessions:list', requestBusinessId);
      const exportSessions: SellerSessionSummary[] = [];
      const seenSessions = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      let snapshot: string | null = null;
      let hasMore = true;

      while (hasMore) {
        let result: Awaited<ReturnType<typeof getSellerBusinessSessions>>;
        try {
          result = await getSellerBusinessSessions(
            requestBusinessId,
            auth,
            SELLER_SESSION_PAGE_LIMIT,
            cursor,
            snapshot
          );
        } catch (err) {
          if (!(err instanceof Error) || !err.message.toLowerCase().includes('authorization expired')) throw err;
          auth = await signSellerAction('sessions:list', requestBusinessId);
          result = await getSellerBusinessSessions(
            requestBusinessId,
            auth,
            SELLER_SESSION_PAGE_LIMIT,
            cursor,
            snapshot
          );
        }
        for (const session of result.sessions) {
          if (!seenSessions.has(session.id)) {
            seenSessions.add(session.id);
            exportSessions.push(session);
          }
        }
        hasMore = result.pagination.hasMore;
        cursor = result.pagination.nextCursor;
        snapshot = result.pagination.snapshot;
        if (hasMore && (!cursor || seenCursors.has(cursor))) {
          throw new Error('Session history pagination stopped safely because the server cursor did not advance.');
        }
        if (cursor) seenCursors.add(cursor);
      }

      if (
        activeBusinessIdRef.current !== requestBusinessId ||
        activeWalletAddressRef.current !== requestWalletAddress
      ) {
        setStatus('Seller context changed. Export cancelled before creating a file.');
        return;
      }
      if (exportSessions.length === 0) {
        setError('This seller profile has no session history to export.');
        return;
      }
      const sellerName = selectedBusiness?.name || businessName || businessId || 'IFR Partner Shop';
      saveSessionCsv(sellerName, exportSessions);
      setStatus(`Downloaded ${exportSessions.length} session${exportSessions.length === 1 ? '' : 's'} with masked customer wallets.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to export full session history');
    } finally {
      setLoading(false);
    }
  }

  async function copySessionCsv() {
    if (!sessionHistoryIsCurrent || visibleSessions.length === 0) {
      setError('Connect the seller owner wallet and load recent sessions before copying an export.');
      return;
    }
    const sellerName = selectedBusiness?.name || businessName || businessId || 'IFR Partner Shop';
    await copyToClipboard('Loaded session CSV', buildSellerSessionCsv(sellerName, visibleSessions));
  }

  async function loadSellerBusinesses() {
    if (!canUseWalletOwner) {
      setError('Connect the seller wallet to load owned seller profiles.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const result = await getSellerBusinesses(await signSellerAction('business:list', 'seller'));
      setSellerBusinesses(result.businesses);
      const preferredBusiness = result.businesses.find((business) => business.id === businessId)
        || result.businesses[0];
      if (preferredBusiness) selectSellerBusiness(preferredBusiness, false);
      setStatus(`Loaded ${result.businesses.length} seller profile${result.businesses.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load seller profiles');
    } finally {
      setLoading(false);
    }
  }

  async function loadAdminBusinessProfile() {
    const targetBusinessId = businessId.trim();
    if (!targetBusinessId || !adminSecret) {
      setError('Business ID and operator admin fallback are required.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const business = await getAdminBusinessProfile(targetBusinessId, adminSecret);
      setSellerBusinesses((current) => [
        business,
        ...current.filter((item) => item.id !== business.id),
      ]);
      selectSellerBusiness(business, false);
      setStatus(`${business.name} loaded through the operator fallback.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load seller profile');
    } finally {
      setLoading(false);
    }
  }

  async function loadRestoredBusinessProfile() {
    if (adminSecret) {
      await loadAdminBusinessProfile();
      return;
    }
    if (canUseWalletOwner) {
      await loadSellerBusinesses();
      return;
    }
    setError('Connect the profile owner wallet or enter the operator admin fallback first.');
  }

  function checkoutOperatorExpiry() {
    if (operatorDuration === 'never') return null;
    const durationMs = operatorDuration === 'shift'
      ? 8 * 60 * 60 * 1000
      : operatorDuration === 'week'
        ? 7 * 24 * 60 * 60 * 1000
        : 30 * 24 * 60 * 60 * 1000;
    return new Date(Date.now() + durationMs).toISOString();
  }

  async function loadCheckoutOperators() {
    if (!businessId || !canUseWalletOwner) {
      setError('Select a seller profile and connect its owner wallet to load the counter team.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const result = await getSellerCheckoutOperators(
        businessId,
        await signSellerAction('operators:list', businessId)
      );
      setCheckoutOperators(result.operators);
      setStatus(`Loaded ${result.operators.length} checkout operator${result.operators.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load checkout operators');
    } finally {
      setLoading(false);
    }
  }

  async function addCheckoutOperator() {
    if (!businessId || !canUseWalletOwner) {
      setError('Select a seller profile and connect its owner wallet before adding counter staff.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const operator = await createSellerCheckoutOperator(
        businessId,
        await signSellerAction('operators:create', businessId, operatorWallet.trim().toLowerCase()),
        {
          walletAddress: operatorWallet.trim(),
          label: operatorLabel.trim() || undefined,
          expiresAt: checkoutOperatorExpiry(),
        }
      );
      setCheckoutOperators((current) => [
        operator,
        ...current.filter((item) => item.id !== operator.id),
      ]);
      setOperatorWallet('');
      setStatus('Checkout operator added. The wallet can verify access and redeem approved sessions only.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add checkout operator');
    } finally {
      setLoading(false);
    }
  }

  async function revokeCheckoutOperator(operator: CheckoutOperator) {
    if (!businessId || !canUseWalletOwner) {
      setError('Connect the seller profile owner wallet before revoking counter access.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      await deleteSellerCheckoutOperator(
        operator.id,
        await signSellerAction('operators:delete', businessId, operator.id)
      );
      setCheckoutOperators((current) => current.map((item) => (
        item.id === operator.id ? { ...item, active: false } : item
      )));
      setStatus('Checkout operator revoked. New redeem attempts from that wallet are blocked immediately.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to revoke checkout operator');
    } finally {
      setLoading(false);
    }
  }

  async function deactivateSellerBusiness(targetBusinessId: string) {
    if (!canUseWalletOwner) {
      setError('Connect the seller wallet to deactivate a seller profile.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      await deleteSellerBusiness(
        targetBusinessId,
        await signSellerAction('business:delete', targetBusinessId, targetBusinessId)
      );
      setSellerBusinesses((current) => current.filter((item) => item.id !== targetBusinessId));
      if (businessId === targetBusinessId) {
        setActiveBusinessId('');
        setRules([]);
        setSessions([]);
        setActivityMetrics(null);
        setPublicListing(null);
      }
      setStatus('Seller profile deactivated.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to deactivate seller profile');
    } finally {
      setLoading(false);
    }
  }

  async function saveRule() {
    if (!businessId || !canManageSelectedBusiness) {
      setError('Business ID plus seller wallet or admin secret are required.');
      return;
    }
    if (
      !Number.isInteger(dailyLimit) || dailyLimit < 0 || dailyLimit > 1000 ||
      !Number.isInteger(monthlyLimit) || monthlyLimit < 0 || monthlyLimit > 10000
    ) {
      setError('Wallet limits must be whole numbers. Use 0 for unlimited, up to 1,000/day and 10,000/month.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      if (editingRuleId && !editingRule) {
        throw new Error('The rule being edited is no longer loaded. Reload rules and try again.');
      }

      if (editingRule) {
        const { active: _active, ...updatePayload } = payload;
        const updated = canUseWalletOwner
          ? await updateSellerBusinessRule(
              editingRule.id,
              await signSellerAction('rules:update', editingRule.businessId, editingRule.id),
              updatePayload
            )
          : await updateAdminBusinessRule(editingRule.id, adminSecret, updatePayload);
        setRules((current) => current
          .map((item) => (item.id === updated.id ? updated : item))
          .sort((a, b) => a.requiredLockIFR - b.requiredLockIFR));
        setEditingRuleId(null);
        resetRuleDraft();
        const publicOfferVisible = updated.active
          ? await verifyPublicListing(updated.id, false)
          : await verifyPublicListing(undefined, false);
        setStatus(updated.active && publicOfferVisible
          ? 'Rule updated and verified in public discovery.'
          : 'Rule updated. Public verification did not confirm this offer yet; use Verify public offer.'
        );
      } else {
        const rule = canUseWalletOwner
          ? await createSellerBusinessRule(
              businessId,
              await signSellerAction('rules:create', businessId, businessId),
              payload
            )
          : await createAdminBusinessRule(businessId, adminSecret, payload);
        setRules((current) => [...current, rule].sort((a, b) => a.requiredLockIFR - b.requiredLockIFR));
        const publicOfferVisible = rule.active
          ? await verifyPublicListing(rule.id, false)
          : false;
        setStatus(publicOfferVisible
          ? 'Rule saved and verified in public discovery.'
          : 'Rule saved. Public verification did not confirm it yet; use Verify public offer.'
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save rule');
    } finally {
      setLoading(false);
    }
  }

  function beginRuleEdit(rule: BenefitRule) {
    setEditingRuleId(rule.id);
    setLabel(rule.label);
    setCategory(rule.category);
    setProduct(rule.productName);
    setSelectedProductId(rule.productId || '');
    setDiscount(rule.discountPercent);
    setMinLocked(rule.requiredLockIFR);
    setMinHeld(rule.minIFRHeld);
    setLockSource(rule.lockSource);
    setDailyLimit(rule.dailyRedemptionLimit);
    setMonthlyLimit(rule.monthlyRedemptionLimit);
    setTtl(rule.ttlSeconds);
    setError('');
    setStatus(`Editing ${rule.label}. Changes apply only after the signed update is confirmed.`);
    window.requestAnimationFrame(() => {
      document.getElementById('seller-rule-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function useCatalogProduct(productItem: CatalogProduct) {
    setSelectedProductId(productItem.id);
    setProduct(productItem.name);
    setCategory(productItem.category);
    setError('');
    setStatus(`${productItem.name} selected. Save the rule to bind a stable product snapshot.`);
    window.requestAnimationFrame(() => {
      document.getElementById('seller-rule-editor')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  }

  function cancelRuleEdit() {
    setEditingRuleId(null);
    resetRuleDraft();
    setError('');
    setStatus('Rule edit cancelled.');
  }

  async function toggleRule(rule: BenefitRule) {
    if (!canManageSelectedBusiness) {
      setError('Connect the seller wallet or use the operator admin fallback.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      const updated = canUseWalletOwner
        ? await updateSellerBusinessRule(
            rule.id,
            await signSellerAction('rules:update', rule.businessId, rule.id),
            { active: !rule.active }
          )
        : await updateAdminBusinessRule(rule.id, adminSecret, { active: !rule.active });
      setRules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      const publicOfferVisible = updated.active
        ? await verifyPublicListing(updated.id, false)
        : await verifyPublicListing(undefined, false);
      setStatus(updated.active
        ? publicOfferVisible
          ? 'Rule activated and verified in public discovery.'
          : 'Rule activated. Public verification did not confirm it yet; use Verify public offer.'
        : 'Rule paused. Public discovery status refreshed.'
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update rule');
    } finally {
      setLoading(false);
    }
  }

  async function archiveRule(ruleId: string) {
    const rule = rules.find((item) => item.id === ruleId);
    if (!canManageSelectedBusiness || !rule) {
      setError('Connect the seller wallet or use the operator admin fallback.');
      return;
    }
    setLoading(true);
    setError('');
    setStatus('');
    try {
      if (canUseWalletOwner) {
        await deleteSellerBusinessRule(
          ruleId,
          await signSellerAction('rules:delete', rule.businessId, rule.id)
        );
      } else {
        await deleteAdminBusinessRule(ruleId, adminSecret);
      }
      setRules((current) => current.filter((item) => item.id !== ruleId));
      if (editingRuleId === ruleId) setEditingRuleId(null);
      await verifyPublicListing(undefined, false);
      setStatus('Rule archived. Existing checkout history remains available.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive rule');
    } finally {
      setLoading(false);
    }
  }

  async function connectSellerWallet() {
    setError('');
    setStatus('');
    const connector = await selectPreferredWalletConnector(connectors) as (typeof connectors)[number] | undefined;
    if (!connector) {
      setError('No wallet connector is available in this browser.');
      return;
    }
    await connectSellerConnector(connector);
  }

  async function connectSellerConnector(connector: (typeof connectors)[number]) {
    setError('');
    setStatus('');
    try {
      await connectAsync({ connector });
    } catch (err) {
      setError(walletConnectionErrorMessage(err));
    }
  }

  async function signSellerAction(
    action: string,
    targetBusinessId: string,
    scope?: string
  ): Promise<SellerAuth> {
    if (!address) throw new Error('Connect the seller wallet first.');
    const challenge = await getSellerAuthMessage(
      action,
      targetBusinessId,
      scope ? { walletAddress: address, scope } : undefined
    );
    if (scope && !challenge.nonce) throw new Error('Seller authorization challenge is incomplete');
    const signature = await signMessageAsync({ message: challenge.message });
    return {
      walletAddress: address,
      signature,
      timestamp: challenge.timestamp,
      nonce: challenge.nonce,
    };
  }

  async function copyToClipboard(labelText: string, value: string) {
    if (!value) {
      setError(`${labelText} is not ready yet.`);
      return;
    }
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const fallback = document.createElement('textarea');
        fallback.value = value;
        fallback.readOnly = true;
        fallback.style.position = 'fixed';
        fallback.style.opacity = '0';
        document.body.appendChild(fallback);
        fallback.select();
        const copied = document.execCommand('copy');
        fallback.remove();
        if (!copied) throw new Error('Copy command was rejected');
      }
      setError('');
      setStatus(`${labelText} copied.`);
    } catch {
      setError(`Could not copy ${labelText.toLowerCase()} in this browser.`);
    }
  }

  async function shareScannerLink() {
    if (!scannerUrl) {
      setError('Create or select a seller profile before sharing the scanner link.');
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${businessName || 'IFR Partner Shop'} IFR scanner`,
          text: 'Open this scanner at checkout to verify locked IFR access.',
          url: scannerUrl,
        });
        setError('');
        setStatus('Scanner link shared.');
        return;
      }
      await copyToClipboard('Scanner link', scannerUrl);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Could not share scanner link.');
    }
  }

  async function shareCheckoutKit() {
    if (!scannerUrl) {
      setError('Create or select a seller profile before sharing the checkout kit.');
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${businessName || 'IFR Partner Shop'} IFR checkout kit`,
          text: checkoutKitText,
          url: scannerUrl,
        });
        setError('');
        setStatus('Checkout kit shared.');
        return;
      }
      await copyToClipboard('Checkout kit', checkoutKitText);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Could not share checkout kit.');
    }
  }

  async function shareSellerBackup() {
    if (!businessId) {
      setError('Create or select a seller profile before sharing a seller backup.');
      return;
    }
    try {
      if (navigator.share) {
        await navigator.share({
          title: `${businessName || 'IFR Partner Shop'} IFR seller backup`,
          text: sellerBackupText,
          url: scannerUrl || undefined,
        });
        setError('');
        setStatus('Seller backup shared.');
        return;
      }
      await copyToClipboard('Seller backup', sellerBackupText);
    } catch (err) {
      if (err instanceof Error && err.name === 'AbortError') return;
      setError(err instanceof Error ? err.message : 'Could not share seller backup.');
    }
  }

  async function restoreSellerBackup() {
    const raw = restoreInput.trim();
    if (!raw) {
      setError('Paste a seller backup JSON or Business ID first.');
      return;
    }

    try {
      if (raw.startsWith('{')) {
        const parsed = JSON.parse(raw) as {
          businessId?: unknown;
          sellerSlug?: unknown;
          sellerName?: unknown;
          defaultBenefit?: Partial<BenefitRuleInput>;
        };
        const restoredBusinessId = typeof parsed.businessId === 'string'
          ? parseBusinessReference(parsed.businessId)
          : '';
        if (!restoredBusinessId) {
          setError('Seller backup does not include a valid Business ID.');
          return;
        }
        setActiveBusinessId(restoredBusinessId);
        if (typeof parsed.sellerSlug === 'string' && !businessSlugError(parsed.sellerSlug)) {
          setBusinessSlugDraft(parsed.sellerSlug);
        }
        if (typeof parsed.sellerName === 'string' && parsed.sellerName.trim()) setBusinessName(parsed.sellerName.trim());
        if (parsed.defaultBenefit) {
          if (typeof parsed.defaultBenefit.label === 'string') setLabel(parsed.defaultBenefit.label);
          if (typeof parsed.defaultBenefit.category === 'string') setCategory(parsed.defaultBenefit.category);
          if (typeof parsed.defaultBenefit.productName === 'string') setProduct(parsed.defaultBenefit.productName);
          if (typeof parsed.defaultBenefit.discountPercent === 'number') setDiscount(parsed.defaultBenefit.discountPercent);
          if (typeof parsed.defaultBenefit.requiredLockIFR === 'number') setMinLocked(parsed.defaultBenefit.requiredLockIFR);
          if (typeof parsed.defaultBenefit.minIFRHeld === 'number') setMinHeld(parsed.defaultBenefit.minIFRHeld);
          if (isLockSource(parsed.defaultBenefit.lockSource)) setLockSource(parsed.defaultBenefit.lockSource);
          if (typeof parsed.defaultBenefit.dailyRedemptionLimit === 'number') setDailyLimit(parsed.defaultBenefit.dailyRedemptionLimit);
          if (typeof parsed.defaultBenefit.monthlyRedemptionLimit === 'number') setMonthlyLimit(parsed.defaultBenefit.monthlyRedemptionLimit);
          if (typeof parsed.defaultBenefit.ttlSeconds === 'number') setTtl(parsed.defaultBenefit.ttlSeconds);
        }
        setRules([]);
        setSessions([]);
        setActivityMetrics(null);
        setError('');
        setStatus('Seller backup restored. Connect the owner wallet, then load rules or sessions.');
        return;
      }

      const businessRefFromText = parseBusinessReference(raw);
      if (!businessRefFromText) {
        setError('Could not read a seller URL or Business ID from that backup.');
        return;
      }
      let resolvedBusinessId = businessRefFromText;
      try {
        const resolved = await getBusiness(businessRefFromText);
        resolvedBusinessId = resolved.id;
        if (resolved.slug) setBusinessSlugDraft(resolved.slug);
      } catch {
        // Legacy admin-created profiles may only be resolvable by their internal ID.
      }
      setActiveBusinessId(resolvedBusinessId);
      setRules([]);
      setSessions([]);
      setActivityMetrics(null);
      setError('');
      setStatus('Seller reference restored. Connect the owner wallet, then load the profile, rules or sessions.');
    } catch {
      setError('Could not parse seller backup JSON.');
    }
  }

  return (
    <section className="rounded-[2rem] border border-orange-200/15 bg-orange-100/[0.06] p-5 shadow-2xl shadow-black/30 backdrop-blur">
      <div className="mb-5">
        <p className="text-xs font-bold uppercase tracking-[0.18em] text-orange-200/80">
          Seller mode
        </p>
        <h2 className="mt-1 text-2xl font-black text-white">Benefit rule manager</h2>
        <p className="mt-2 text-sm leading-6 text-stone-300">
          Create a seller profile with a wallet signature, define discount rules, then open the scanner link at checkout. Operator admin fallback remains available for controlled setup.
        </p>
      </div>

      <nav aria-label="Seller tasks" className="mb-5 overflow-x-auto rounded-2xl border border-orange-200/15 bg-black/20 p-2">
        <div className="flex min-w-max gap-2">
          {sellerTasks.map((task) => (
            <a
              key={task.href}
              href={task.href}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-white/10 px-3 py-2 text-xs font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-orange-200/50 hover:bg-orange-200/10"
            >
              {'ready' in task ? (
                <>
                  <span
                    aria-hidden="true"
                    className={`h-2 w-2 rounded-full ${task.ready ? 'bg-green-300' : 'bg-stone-600'}`}
                  />
                  <span className="sr-only">{task.ready ? 'Ready' : 'Not ready'}: </span>
                </>
              ) : null}
              {task.label}
            </a>
          ))}
        </div>
      </nav>

      <div className="mb-5 rounded-3xl border border-green-300/20 bg-green-300/[0.07] p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-100/80">Seller wallet owner</p>
            <h3 className="mt-1 text-xl font-black text-white">
              {address ? `${address.slice(0, 6)}...${address.slice(-4)}` : 'Connect seller wallet'}
            </h3>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              Seller actions are authorized with short-lived wallet signatures. No customer tokens are moved, no private key is stored, and public profile creation is rate-limited.
            </p>
          </div>
          {address ? (
            <button
              type="button"
              onClick={() => disconnect()}
              className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-100 hover:border-green-200/60"
            >
              Disconnect
            </button>
          ) : (
            <div className="grid gap-2">
              <button
                type="button"
                onClick={connectSellerWallet}
                disabled={connecting}
                className="rounded-2xl bg-green-300 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-green-950/30 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {connecting ? 'Connecting...' : 'Connect wallet'}
              </button>
              {availableConnectors.length > 1 ? (
                <details className="text-right">
                  <summary className="cursor-pointer text-xs font-bold text-green-50">Choose wallet</summary>
                  <div className="mt-2 grid gap-2">
                    {availableConnectors.map((availableConnector) => (
                      <button
                        key={availableConnector.uid}
                        type="button"
                        onClick={() => connectSellerConnector(availableConnector)}
                        disabled={connecting}
                        className="rounded-xl border border-green-200/30 px-3 py-2 text-xs font-black text-green-50 disabled:opacity-50"
                      >
                        {walletConnectorLabel(availableConnector)}
                      </button>
                    ))}
                  </div>
                </details>
              ) : null}
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadSellerBusinesses}
            disabled={loading || !canUseWalletOwner}
            className="rounded-2xl border border-green-200/40 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Load my seller profiles
          </button>
          {businessId ? (
            <a
              href={scannerUrl}
              className="rounded-2xl border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-green-200/60"
            >
              Open scanner
            </a>
          ) : null}
        </div>
        {sellerBusinesses.length > 0 ? (
          <div className="mt-4 grid gap-2">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-100/70">My seller profiles</p>
            {sellerBusinesses.map((business) => (
              <div
                key={business.id}
                className={`rounded-2xl border p-3 text-left transition ${
                  business.id === businessId
                    ? 'border-green-200/60 bg-green-200/15'
                    : 'border-white/10 bg-black/20 hover:border-green-200/40'
                }`}
              >
                <button
                  type="button"
                  onClick={() => selectSellerBusiness(business)}
                  disabled={loading}
                  className="block w-full text-left disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <span className="flex items-center gap-3">
                    <BusinessLogo name={business.name} logoUrl={business.logoUrl} size="sm" />
                    <span className="min-w-0 break-words text-sm font-black text-white">{business.name}</span>
                  </span>
                  <span className="mt-1 block text-xs leading-5 text-stone-300">
                    {business.productsCount} catalog item{business.productsCount === 1 ? '' : 's'} / {business.rulesCount} rule{business.rulesCount === 1 ? '' : 's'} / {business.discountPercent}% default / {business.requiredLockIFR.toLocaleString('en-US')} IFR
                  </span>
                  {business.categories.length ? (
                    <span className="mt-2 block text-xs font-semibold text-green-100/80">
                      {business.categories.join(' · ')}
                    </span>
                  ) : null}
                  {business.serviceArea ? (
                    <span className="mt-2 block text-xs font-semibold text-orange-100/85">
                      Available in {business.serviceArea}
                    </span>
                  ) : null}
                  {business.slug ? (
                    <span className="mt-2 block text-xs font-bold text-green-100">
                      shop.ifrunit.tech/s/{business.slug}
                    </span>
                  ) : null}
                  <span className="mt-1 block break-all font-mono text-[11px] text-stone-500">{business.id}</span>
                </button>
                <div className="mt-3 flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => selectSellerBusiness(business)}
                    disabled={loading}
                    className="rounded-xl border border-green-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Select
                  </button>
                  <button
                    type="button"
                    onClick={() => deactivateSellerBusiness(business.id)}
                    disabled={loading}
                    className="rounded-xl border border-red-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-200/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Deactivate
                  </button>
                </div>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div id="seller-launch" className="mb-5 scroll-mt-28 rounded-3xl border border-orange-200/20 bg-[#1d130c] p-4 shadow-xl shadow-black/20">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Seller readiness</p>
            <h3 className="mt-1 text-2xl font-black text-white">{sellerStatus}</h3>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-300">{nextSellerStep}</p>
          </div>
          <div className="rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-right">
            <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Launch progress</p>
            <p className="mt-1 text-sm font-black text-white">
              {launchChecksReady}/4 required checks
            </p>
            <p className="mt-1 text-xs text-stone-400">
              {selectedBusiness?.name || (businessReady ? 'Manual business ID' : 'No profile selected')}
            </p>
          </div>
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          {sellerReadinessSteps.map((step) => (
            <div
              key={step.label}
              className={`flex items-center gap-3 rounded-2xl border px-4 py-3 text-sm ${
                step.ready
                  ? 'border-green-300/25 bg-green-300/[0.08] text-green-50'
                  : 'border-white/10 bg-black/20 text-stone-300'
              }`}
            >
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                  step.ready ? 'bg-green-300 shadow-[0_0_16px_rgba(134,239,172,0.75)]' : 'bg-stone-600'
                }`}
              />
              <span className="font-semibold">{step.label}</span>
              {step.optional ? (
                <span className="ml-auto rounded-full border border-white/10 px-2 py-1 text-[10px] font-black uppercase tracking-[0.1em] text-stone-400">
                  Recommended
                </span>
              ) : null}
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={loadSellerBusinesses}
            disabled={loading || !canUseWalletOwner}
            className="rounded-2xl border border-green-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Load profiles
          </button>
          <button
            type="button"
            onClick={loadRules}
            disabled={loading || !businessReady || !canManageSelectedBusiness}
            className="rounded-2xl border border-orange-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Load rules
          </button>
          {!profileReady ? (
            <a
              href="#seller-profile"
              className="rounded-2xl bg-orange-300 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:bg-orange-200"
            >
              Create or load profile
            </a>
          ) : !ruleReady ? (
            <a
              href={activeCatalogCount > 0 ? '#seller-rule-editor' : '#seller-catalog'}
              className="rounded-2xl bg-orange-300 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:bg-orange-200"
            >
              {activeCatalogCount > 0 ? 'Create benefit rule' : 'Add product or service'}
            </a>
          ) : !publicListingReady ? (
            <button
              type="button"
              onClick={() => verifyPublicListing()}
              disabled={verifyingPublicListing}
              className="rounded-2xl bg-orange-300 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {verifyingPublicListing ? 'Checking public offer...' : 'Verify public offer'}
            </button>
          ) : (
            <a
              href={catalogUrl}
              className="rounded-2xl bg-orange-300 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Open public catalog
            </a>
          )}
          {scannerReady && publicListingReady ? (
            <a
              href={scannerUrl}
              className="rounded-2xl border border-orange-200/45 px-4 py-3 text-center text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10"
            >
              Open checkout scanner
            </a>
          ) : null}
        </div>

        {publicListing ? (
          <div className={`mt-4 rounded-2xl border p-3 text-sm ${
            publicListingReady
              ? 'border-green-300/30 bg-green-300/[0.08] text-green-50'
              : 'border-orange-200/25 bg-orange-200/[0.06] text-orange-50'
          }`}>
            <p className="font-bold">
              {publicListingReady
                ? `${publicListing.offerCount} public offer${publicListing.offerCount === 1 ? '' : 's'} verified`
                : publicListing.error || 'No active public offer verified yet'}
            </p>
            <p className="mt-1 text-xs text-stone-300">
              Exact Business ID checked {new Date(publicListing.checkedAt).toLocaleString()}.
            </p>
          </div>
        ) : null}
      </div>

      <div id="seller-profile" className="mb-5 scroll-mt-28 rounded-3xl border border-white/10 bg-black/20 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Seller onboarding</p>
            <h3 className="mt-1 text-xl font-black text-white">
              {selectedBusiness
                ? 'Manage public seller profile'
                : profileNeedsLoading
                  ? 'Load existing seller profile'
                  : 'Create a seller profile'}
            </h3>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              {selectedBusiness
                ? 'These public details help customers find and recognize your offers. Saving requires the owner wallet or the controlled admin fallback used to create it.'
                : profileNeedsLoading
                  ? 'This Business ID already exists in local recovery state. Load it with the owner wallet or controlled admin fallback before editing.'
                  : 'Connect the seller wallet to create a checkout-capable profile. The admin secret is only a controlled fallback for existing profiles.'}
            </p>
          </div>
          {createdBusiness ? (
            <span className="rounded-full bg-green-400/15 px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] text-green-100">
              Created
            </span>
          ) : null}
        </div>
        {!selectedBusiness ? (
          <details className="mt-4 rounded-2xl border border-green-200/20 bg-green-200/[0.06] p-4">
            <summary className="cursor-pointer text-sm font-black text-green-50">
              Open an existing seller setup
            </summary>
            <p className="mt-2 text-xs leading-5 text-stone-400">
              Paste a Business ID, scanner/catalog URL or public seller backup. Secrets and wallet signatures never belong in this field.
            </p>
            <label className="mt-3 grid gap-2 text-sm font-semibold text-stone-200">
              Existing seller reference
              <textarea
                value={restoreInput}
                onChange={(event) => setRestoreInput(event.target.value)}
                rows={3}
                placeholder="Business ID, seller URL or backup JSON"
                className="min-h-24 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-green-300"
              />
            </label>
            <button
              type="button"
              onClick={restoreSellerBackup}
              disabled={!restoreInput.trim()}
              className="mt-3 w-full rounded-2xl border border-green-200/35 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Restore seller reference
            </button>
          </details>
        ) : null}
        {canUseWalletOwner || profileNeedsLoading || selectedBusiness ? (
          <>
        <div className="mt-4 flex items-center gap-4 rounded-2xl border border-orange-200/15 bg-orange-200/[0.05] p-4">
          <BusinessLogo
            name={businessName || 'IFR Partner Shop'}
            logoUrl={businessLogoUrl || null}
            size="lg"
            eager
          />
          <div className="min-w-0">
            <p className="text-xs font-black uppercase tracking-[0.14em] text-orange-100">Customer-facing identity</p>
            <p className="mt-1 break-words text-sm font-bold text-white">{businessName || 'IFR Partner Shop'}</p>
            <p className="mt-1 text-xs leading-5 text-stone-400">Preview used in offer search, catalog and checkout.</p>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="grid gap-2 text-sm font-semibold text-stone-200">
            Shop or seller name
            <input
              value={businessName}
              onChange={(event) => updateBusinessName(event.target.value)}
              disabled={loading || profileNeedsLoading}
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
            />
          </label>
          <div className="grid gap-2 text-sm font-semibold text-stone-200 md:col-span-2">
            <label htmlFor="seller-url-slug">Permanent seller URL</label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <span className="flex items-center rounded-2xl border border-white/10 bg-black/20 px-4 py-3 text-xs text-stone-400">
                shop.ifrunit.tech/s/
              </span>
              <input
                id="seller-url-slug"
                value={selectedBusiness?.slug || businessSlugDraft}
                onChange={(event) => setBusinessSlugDraft(normalizeBusinessSlug(event.target.value))}
                maxLength={48}
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                readOnly={Boolean(selectedBusiness?.slug)}
                disabled={loading || profileNeedsLoading}
                className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300 read-only:cursor-default read-only:text-green-100 disabled:cursor-not-allowed disabled:opacity-50"
              />
              {selectedBusiness && !selectedBusiness.slug && selectedBusinessUsesWalletOwner ? (
                <button
                  type="button"
                  onClick={claimSellerSlug}
                  disabled={loading || !selectedBusinessOwnerMatchesWallet || Boolean(businessSlugError(businessSlugDraft))}
                  className="rounded-2xl bg-green-300 px-5 py-3 text-xs font-black uppercase tracking-[0.12em] text-stone-950 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Claim URL
                </button>
              ) : null}
            </div>
            <span className="text-xs font-normal leading-5 text-stone-500">
              {selectedBusiness?.slug
                ? 'Permanent and active. Existing Business-ID links continue to work.'
                : selectedBusiness
                  ? 'Choose carefully: the owner signs this URL once and it cannot be renamed.'
                  : 'This URL is signed during profile creation and remains stable when the shop name changes.'}
            </span>
            {!selectedBusiness?.slug && businessSlugError(businessSlugDraft) ? (
              <span className="text-xs font-semibold text-orange-100">{businessSlugError(businessSlugDraft)}</span>
            ) : null}
          </div>
          <details className="rounded-2xl border border-white/10 bg-black/20 p-4 md:col-span-2">
            <summary className="cursor-pointer text-sm font-black text-white">
              Public discovery details <span className="font-semibold text-stone-400">(recommended)</span>
            </summary>
            <p className="mt-2 text-xs leading-5 text-stone-400">
              Add a description, website, logo and broad service area so customers can recognize and find this seller.
            </p>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              <label className="grid gap-2 text-sm font-semibold text-stone-200 md:col-span-2">
                Public description
                <textarea
                  value={businessDescription}
                  onChange={(event) => setBusinessDescription(event.target.value)}
                  maxLength={500}
                  rows={3}
                  disabled={loading || profileNeedsLoading}
                  placeholder="What customers can find here and why IFR members benefit."
                  className="resize-y rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-xs font-normal text-stone-500">{businessDescription.length}/500</span>
              </label>
              <label className="grid gap-2 text-sm font-semibold text-stone-200">
                Seller website
                <input
                  type="url"
                  value={businessWebsite}
                  onChange={(event) => setBusinessWebsite(event.target.value)}
                  maxLength={300}
                  placeholder="https://example.com"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={loading || profileNeedsLoading}
                  className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
                />
              </label>
              <label className="grid gap-2 text-sm font-semibold text-stone-200">
                Seller logo URL
                <input
                  type="url"
                  value={businessLogoUrl}
                  onChange={(event) => setBusinessLogoUrl(event.target.value)}
                  maxLength={500}
                  placeholder="https://example.com/logo.png"
                  autoCapitalize="none"
                  autoCorrect="off"
                  spellCheck={false}
                  disabled={loading || profileNeedsLoading}
                  className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-xs font-normal leading-5 text-stone-500">
                  Optional HTTPS image. Customer browsers load it from that host without sending the Shop referrer.
                </span>
              </label>
              <div className="grid gap-2 text-sm font-semibold text-stone-200 md:col-span-2">
                <label htmlFor="seller-service-area">City, region or Online</label>
                <input
                  id="seller-service-area"
                  value={businessServiceArea}
                  onChange={(event) => {
                    setBusinessServiceArea(event.target.value);
                    setServiceAreaDisclosureConfirmed(false);
                  }}
                  maxLength={80}
                  placeholder="Athens, Attica or Online"
                  disabled={loading || profileNeedsLoading}
                  className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
                />
                <span className="text-xs font-normal leading-5 text-stone-500">
                  This exact text is stored and shown publicly. Enter only a broad service area, never a private or street address.
                </span>
                {businessServiceArea.trim() ? (
                  <label className="flex items-start gap-3 rounded-2xl border border-orange-200/20 bg-orange-200/[0.06] px-4 py-3 text-xs font-medium leading-5 text-stone-300">
                    <input
                      type="checkbox"
                      checked={serviceAreaDisclosureConfirmed}
                      onChange={(event) => setServiceAreaDisclosureConfirmed(event.target.checked)}
                      disabled={loading || profileNeedsLoading}
                      className="mt-0.5 h-4 w-4 shrink-0 accent-orange-400"
                    />
                    <span>I understand this text is public and confirm it contains only a city, region or Online label.</span>
                  </label>
                ) : null}
              </div>
            </div>
          </details>
          <label className="grid gap-2 text-sm font-semibold text-stone-200">
            {selectedBusiness ? 'Profile authorization' : 'Access tier label'}
            {selectedBusiness ? (
              <span className="rounded-2xl border border-green-200/20 bg-green-200/[0.08] px-4 py-3 text-sm font-semibold text-green-50">
                {selectedBusinessUsesWalletOwner
                  ? 'Connect the profile owner wallet to save changes.'
                  : 'This operator-created profile uses the admin fallback below.'}
              </span>
            ) : (
              <input
                value={defaultTier}
                onChange={(event) => setDefaultTier(event.target.value)}
                disabled={loading || profileNeedsLoading}
                className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
              />
            )}
          </label>
          {(!selectedBusiness || !selectedBusinessUsesWalletOwner) ? <label className="grid gap-2 text-sm font-semibold text-stone-200 md:col-span-2">
            Admin secret
            <input
              type="password"
              value={adminSecret}
              onChange={(event) => setAdminSecret(event.target.value)}
              placeholder="Admin fallback only"
              className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
            />
          </label> : null}
          {!selectedBusiness && businessId ? (
            <button
              type="button"
              onClick={loadAdminBusinessProfile}
              disabled={loading || !adminSecret}
              className="rounded-2xl border border-green-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-40 md:col-span-2"
            >
              Load existing profile by ID
            </button>
          ) : null}
        </div>
        <details className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
          <summary className="cursor-pointer text-sm font-black text-white">
            Business categories
            <span className="ml-2 text-xs font-semibold text-stone-500">{businessCategories.length}/8 selected</span>
          </summary>
          <div className="mt-3 flex flex-wrap gap-2">
            {profileCategorySuggestions.map((profileCategory) => {
              const selected = businessCategories.some(
                (item) => item.toLocaleLowerCase('en-US') === profileCategory.toLocaleLowerCase('en-US')
              );
              return (
                <button
                  key={profileCategory}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleBusinessCategory(profileCategory)}
                  disabled={loading || profileNeedsLoading}
                  className={`rounded-full border px-3 py-2 text-xs font-bold transition disabled:cursor-not-allowed disabled:opacity-50 ${
                    selected
                      ? 'border-green-200/50 bg-green-200/15 text-green-50'
                      : 'border-white/10 text-stone-300 hover:border-green-200/30'
                  }`}
                >
                  {profileCategory}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row">
            <label className="sr-only" htmlFor="seller-custom-category">Custom business category</label>
            <input
              id="seller-custom-category"
              value={profileCategoryDraft}
              onChange={(event) => setProfileCategoryDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault();
                  addBusinessCategory(profileCategoryDraft);
                }
              }}
              maxLength={80}
              placeholder="Add another category"
              disabled={loading || profileNeedsLoading}
              className="min-w-0 flex-1 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-green-300 disabled:cursor-not-allowed disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => addBusinessCategory(profileCategoryDraft)}
              disabled={loading || profileNeedsLoading || !profileCategoryDraft.trim() || businessCategories.length >= 8}
              className="rounded-2xl border border-green-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.12em] text-green-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Add category
            </button>
          </div>
        </details>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <button
            type="button"
            onClick={selectedBusiness
              ? saveSellerProfile
              : profileNeedsLoading
                ? loadRestoredBusinessProfile
                : createBusiness}
            disabled={loading || (
              selectedBusiness
                ? !canEditSelectedProfile
                : profileNeedsLoading
                  ? !canManage
                  : !canUseWalletOwner
            )}
            className="rounded-2xl border border-orange-200/40 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-orange-100 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {selectedBusiness
              ? 'Save public profile'
              : profileNeedsLoading
                ? 'Load existing profile'
              : canUseWalletOwner
                ? 'Create wallet-owned seller profile'
                : 'Connect wallet to create'}
          </button>
          {selectedBusiness ? (
            <button
              type="button"
              onClick={startNewSellerProfile}
              disabled={loading}
              className="rounded-2xl border border-white/15 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/40 disabled:opacity-50"
            >
              New seller profile
            </button>
          ) : null}
        </div>
        {businessId ? (
          <div className="mt-4 rounded-2xl border border-orange-200/20 bg-orange-200/10 p-4 text-sm leading-6 text-orange-50">
            <p>
              <strong>Business ID:</strong> <span className="break-all font-mono">{businessId}</span>
            </p>
            <p className="mt-1">
              <strong>Scanner:</strong>{' '}
              <a href={scannerUrl} className="break-all text-orange-100 underline underline-offset-4">
                {scannerUrl}
              </a>
            </p>
            {selectedBusiness?.slug ? (
              <p className="mt-1">
                <strong>Public catalog:</strong>{' '}
                <a href={catalogUrl} className="break-all text-green-100 underline underline-offset-4">
                  {catalogUrl}
                </a>
              </p>
            ) : null}
            <div className="mt-4 grid gap-2 sm:grid-cols-4">
              <button
                type="button"
                onClick={() => copyToClipboard('Business ID', businessId)}
                className="rounded-xl border border-orange-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-orange-50 transition hover:bg-orange-200/10"
              >
                Copy ID
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard('Scanner link', scannerUrl)}
                className="rounded-xl border border-orange-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-orange-50 transition hover:bg-orange-200/10"
              >
                Copy link
              </button>
              <button
                type="button"
                onClick={shareScannerLink}
                className="rounded-xl border border-orange-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-orange-50 transition hover:bg-orange-200/10"
              >
                Share
              </button>
              <button
                type="button"
                onClick={() => copyToClipboard('Catalog link', catalogUrl)}
                disabled={!catalogUrl}
                className="rounded-xl border border-green-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-green-50 transition hover:bg-green-200/10 disabled:opacity-40"
              >
                Copy catalog
              </button>
              {selectedBusiness ? (
                <a
                  href={catalogUrl}
                  className="rounded-xl border border-green-200/30 px-3 py-2 text-center text-[11px] font-black uppercase tracking-[0.12em] text-green-50 transition hover:bg-green-200/10 sm:col-span-4"
                >
                  Open public catalog
                </a>
              ) : null}
            </div>
          </div>
        ) : null}
          </>
        ) : (
          <div className="mt-4 rounded-2xl border border-orange-200/20 bg-orange-200/[0.06] p-4">
            <p className="text-sm font-black text-white">Connect before entering a new seller profile</p>
            <p className="mt-2 text-xs leading-5 text-stone-400">
              The connected wallet becomes the profile owner and signs every later profile, catalog and benefit-rule change.
            </p>
            <button
              type="button"
              onClick={connectSellerWallet}
              disabled={connecting}
              className="mt-3 w-full rounded-2xl bg-green-300 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-green-950/25 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {connecting ? 'Connecting...' : 'Connect seller wallet'}
            </button>
          </div>
        )}
      </div>

      {status ? <p role="status" aria-live="polite" className="mb-5 rounded-2xl border border-green-300/30 bg-green-500/10 p-3 text-sm text-green-100">{status}</p> : null}
      {error ? <p role="alert" className="mb-5 rounded-2xl border border-red-400/30 bg-red-500/10 p-3 text-sm text-red-200">{error}</p> : null}

      {profileReady ? (
        <>
      <div id="seller-rewards" className="scroll-mt-28">
        <SellerRewardStatus businessId={businessId} />
      </div>

      {businessId ? (
        <div id="seller-team" className="mb-5 scroll-mt-28 rounded-3xl border border-green-300/20 bg-green-300/[0.06] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-100/80">Counter team</p>
              <h3 className="mt-1 text-xl font-black text-white">Delegate checkout access</h3>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-300">
                Add a staff wallet for checkout. Operators can verify their role and redeem an approved QR once;
                they cannot change seller profiles, rules, history or team access.
              </p>
            </div>
            <button
              type="button"
              onClick={loadCheckoutOperators}
              disabled={loading || !canUseWalletOwner}
              className="rounded-2xl border border-green-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Load team
            </button>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-[1.2fr_0.8fr_0.7fr_auto]">
            <label className="grid gap-2 text-sm font-semibold text-stone-200">
              Staff wallet
              <input
                value={operatorWallet}
                onChange={(event) => setOperatorWallet(event.target.value)}
                placeholder="0x..."
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="min-w-0 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 font-mono text-sm text-white outline-none focus:border-green-300"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-200">
              Counter label
              <input
                value={operatorLabel}
                onChange={(event) => setOperatorLabel(event.target.value)}
                placeholder="Front counter"
                className="min-w-0 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-green-300"
              />
            </label>
            <label className="grid gap-2 text-sm font-semibold text-stone-200">
              Access duration
              <select
                value={operatorDuration}
                onChange={(event) => setOperatorDuration(event.target.value as typeof operatorDuration)}
                className="min-w-0 rounded-2xl border border-white/10 bg-[#17110d] px-4 py-3 text-white outline-none focus:border-green-300"
              >
                <option value="shift">8-hour shift</option>
                <option value="week">7 days</option>
                <option value="month">30 days</option>
                <option value="never">No expiry</option>
              </select>
            </label>
            <button
              type="button"
              onClick={addCheckoutOperator}
              disabled={loading || !canUseWalletOwner || !operatorWallet.trim()}
              className="self-end rounded-2xl bg-green-300 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-green-950/25 transition hover:bg-green-200 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Add operator
            </button>
          </div>

          {checkoutOperators.length > 0 ? (
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {checkoutOperators.map((operator) => {
                const expired = Boolean(operator.expiresAt && new Date(operator.expiresAt) <= new Date());
                const available = operator.active && !expired;
                return (
                  <div key={operator.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-black text-white">{operator.label || 'Checkout operator'}</p>
                        <p className="mt-1 break-all font-mono text-[11px] leading-5 text-stone-400">{operator.walletAddress}</p>
                      </div>
                      <span className={`rounded-full px-3 py-1 text-[11px] font-bold uppercase tracking-[0.12em] ${
                        available ? 'bg-green-400/15 text-green-100' : 'bg-red-400/15 text-red-100'
                      }`}>
                        {available ? 'Active' : expired ? 'Expired' : 'Revoked'}
                      </span>
                    </div>
                    <p className="mt-3 text-xs leading-5 text-stone-400">
                      {operator.expiresAt
                        ? `Access until ${new Date(operator.expiresAt).toLocaleString()}`
                        : 'No automatic expiry. Revoke manually when staff access ends.'}
                    </p>
                    {operator.active ? (
                      <button
                        type="button"
                        onClick={() => revokeCheckoutOperator(operator)}
                        disabled={loading || !canUseWalletOwner}
                        className="mt-3 rounded-xl border border-red-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-red-100 transition hover:bg-red-200/10 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Revoke access
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-stone-400">
              No counter team loaded. The owner wallet remains authorized automatically.
            </p>
          )}
        </div>
      ) : null}

      {businessId ? (
        <div className="mb-5 rounded-3xl border border-white/10 bg-[#120d09] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">Checkout kit</p>
              <h3 className="mt-1 text-xl font-black text-white">Share with the counter team</h3>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                Keep this with the POS or send it to staff. It contains no secret and points the team to the seller scanner.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => copyToClipboard('Checkout kit', checkoutKitText)}
                className="rounded-2xl border border-white/15 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60"
              >
                Copy kit
              </button>
              <button
                type="button"
                onClick={shareCheckoutKit}
                className="rounded-2xl border border-orange-200/30 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10"
              >
                Share kit
              </button>
            </div>
          </div>
          <div className="mt-4 grid gap-4 lg:grid-cols-[0.86fr_1.14fr]">
            <div className="rounded-2xl border border-orange-200/25 bg-stone-100 p-4 text-stone-950">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-[#9f351b]">Staff scanner QR</p>
              <div className="mt-4 grid place-items-center rounded-2xl bg-white p-4">
                <QRCode value={scannerUrl} size={168} />
              </div>
              <p className="mt-3 text-sm font-black">Show this QR at the counter.</p>
              <p className="mt-1 break-all font-mono text-[11px] leading-5 text-stone-600">{scannerUrl}</p>
            </div>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/35 p-4 text-xs leading-6 text-orange-50">
              {checkoutKitText}
            </pre>
          </div>
        </div>
      ) : null}

      <div className="mb-5 rounded-3xl border border-green-300/20 bg-[linear-gradient(145deg,rgba(134,239,172,0.08),rgba(255,255,255,0.045)_48%,rgba(249,115,22,0.08))] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-100/80">Seller recovery</p>
            <h3 className="mt-1 text-xl font-black text-white">Move this seller setup to another device</h3>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              Export a public seller backup for staff tablets or restore a saved Business ID. It never includes admin secrets, private keys, seed phrases or wallet signatures.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => copyToClipboard('Seller backup', sellerBackupText)}
              disabled={!businessId}
              className="rounded-2xl border border-green-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Copy backup
            </button>
            <button
              type="button"
              onClick={shareSellerBackup}
              disabled={!businessId}
              className="rounded-2xl border border-orange-200/30 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Share backup
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_auto]">
          <label className="grid gap-2 text-sm font-semibold text-stone-200">
            Restore Business ID or backup JSON
            <textarea
              value={restoreInput}
              onChange={(event) => setRestoreInput(event.target.value)}
              rows={3}
              placeholder="Paste Business ID, scanner URL or seller backup JSON"
              className="min-h-24 rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-green-300"
            />
          </label>
          <button
            type="button"
            onClick={restoreSellerBackup}
            className="self-end rounded-2xl bg-green-300 px-5 py-4 text-sm font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-green-950/25 transition hover:bg-green-200"
          >
            Restore setup
          </button>
        </div>
        <pre className="mt-4 max-h-52 overflow-auto whitespace-pre-wrap rounded-2xl border border-white/10 bg-black/30 p-4 text-xs leading-6 text-green-50">
          {businessId ? sellerBackupText : 'Create or select a seller profile to generate a public recovery backup.'}
        </pre>
      </div>

      <div id="seller-session-history" className="scroll-mt-36">
        {businessId ? (
        <div className="mb-5 rounded-3xl border border-green-300/20 bg-green-300/[0.06] p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-100/80">Session history</p>
              <h3 className="mt-1 text-xl font-black text-white">Customer check history</h3>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                Load the latest QR sessions for this seller profile. Copy proof links or restore
                receipts when staff needs to recover a checkout on another counter device.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={loadSessions}
                disabled={loading || !canUseWalletOwner}
                className="rounded-2xl border border-green-200/40 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Load recent 50
              </button>
              <button
                type="button"
                onClick={downloadSessionCsv}
                disabled={loading || !canUseWalletOwner || !businessId}
                className="rounded-2xl border border-orange-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-orange-50 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Download full CSV
              </button>
              <button
                type="button"
                onClick={copySessionCsv}
                disabled={loading || !sessionHistoryIsCurrent || visibleSessions.length === 0}
                className="rounded-2xl border border-white/15 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100 transition hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Copy loaded CSV
              </button>
            </div>
          </div>
          <p className="mt-3 text-xs leading-5 text-stone-400">
            History is owner-only and loaded in pages of 50. Full CSV export fetches every page,
            masks customer wallets, and creates the file locally without uploading or storing a copy.
          </p>
          {visibleSessions.length > 0 ? (
            <div className="mt-4 grid gap-3">
              {visibleSessions.slice(0, 10).map((session) => {
                const lockedIFR = formatSessionLockedIFR(session.lockAmountRaw);
                const heldIFR = formatSessionHeldIFR(session.walletBalanceRaw);

                return (
                  <div key={session.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-black text-white">
                          {session.label || 'Business default'} {session.productName ? `/ ${session.productName}` : ''}
                        </p>
                        <p className="mt-1 text-xs leading-5 text-stone-400">
                          {new Date(session.createdAt).toLocaleString()} / {session.discountPercent}% / {session.requiredLockIFR.toLocaleString('en-US')} IFR
                        </p>
                        {formatProductPrice(session.basePriceMinor, session.currency) ? (
                          <p className="mt-1 text-xs leading-5 text-stone-400">
                            Reference price: {formatProductPrice(session.basePriceMinor, session.currency)}
                          </p>
                        ) : null}
                        <p className="mt-1 text-xs leading-5 text-stone-400">
                          Wallet use: {session.dailyRedemptionLimit || 'unlimited'} / UTC day and {session.monthlyRedemptionLimit || 'unlimited'} / UTC month
                        </p>
                      </div>
                      <span
                        className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${
                          session.status === 'APPROVED' || session.status === 'REDEEMED'
                            ? 'bg-green-400/15 text-green-100'
                            : session.status === 'REJECTED' || session.status === 'EXPIRED'
                              ? 'bg-red-400/15 text-red-100'
                              : 'bg-orange-300/15 text-orange-100'
                        }`}
                      >
                        {session.status}
                      </span>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs leading-5 text-stone-400">
                      <p className="break-all font-mono">Session: {session.id}</p>
                      {session.recoveredAddress ? <p className="font-mono">Wallet: {maskSellerSessionWallet(session.recoveredAddress)}</p> : null}
                      {lockedIFR ? <p>Locked: {lockedIFR} IFR</p> : null}
                      <p>Accepted source: {lockSourceLabel(session.lockSource)}</p>
                      {session.verifiedLockSource ? (
                        <p>
                          Verified source: {verifiedLockSourceLabel(session.verifiedLockSource)}
                          {session.verificationBlock ? ` at block ${session.verificationBlock}` : ''}
                        </p>
                      ) : null}
                      {session.minIFRHeld > 0 && heldIFR ? (
                        <p>Held at verification: {heldIFR} IFR</p>
                      ) : null}
                      {session.reason ? <p className="text-red-100">Reason: {session.reason}</p> : null}
                      {session.redeemedAt ? <p>Redeemed: {new Date(session.redeemedAt).toLocaleString()}</p> : null}
                    </div>
                    <div className="mt-4 grid gap-2 sm:grid-cols-3">
                      <a
                        href={getCustomerProofUrl(session.id)}
                        target="_blank"
                        rel="noopener"
                        className="rounded-xl border border-green-200/30 px-3 py-2 text-center text-[11px] font-black uppercase tracking-[0.12em] text-green-50 transition hover:bg-green-200/10"
                      >
                        Open proof
                      </a>
                      <button
                        type="button"
                        onClick={() => copyToClipboard('Customer proof link', getCustomerProofUrl(session.id))}
                        className="rounded-xl border border-white/15 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-stone-100 transition hover:border-green-200/60"
                      >
                        Copy proof link
                      </button>
                      <button
                        type="button"
                        onClick={() => copyToClipboard('Session restore receipt', getSessionRestoreReceipt(session))}
                        className="rounded-xl border border-orange-200/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.12em] text-orange-50 transition hover:bg-orange-200/10"
                      >
                        Copy restore receipt
                      </button>
                    </div>
                  </div>
                );
              })}
              {visibleSessions.length > 10 ? (
                <p className="rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-stone-300">
                  Showing the newest 10 of {visibleSessions.length} loaded sessions. The CSV includes all loaded rows.
                </p>
              ) : null}
              {sessionHistoryIsCurrent && sessionHasMore ? (
                <button
                  type="button"
                  onClick={loadOlderSessions}
                  disabled={loading || !sessionNextCursor || !sessionSnapshot}
                  className="rounded-2xl border border-green-200/35 px-4 py-3 text-xs font-black uppercase tracking-[0.14em] text-green-50 transition hover:bg-green-200/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Load 50 older checks
                </button>
              ) : sessionHistoryIsCurrent && visibleSessions.length > 0 ? (
                <p className="text-center text-xs font-semibold text-stone-400">All available sessions are loaded.</p>
              ) : null}
            </div>
          ) : (
            <p className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4 text-sm text-stone-400">
              No session history loaded yet. After loading sessions, proof links and restore receipts
              appear here for counter recovery.
            </p>
          )}
          {visibleActivityMetrics ? (
            <div className="mt-4 rounded-2xl border border-orange-200/20 bg-[#1d130c] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">Seller activity</p>
                  <h4 className="mt-1 text-lg font-black text-white">Checkout performance</h4>
                </div>
                <p className="text-xs text-stone-400">
                  UTC day from {new Date(visibleActivityMetrics.todayStartedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' })}
                </p>
              </div>
              <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                {[
                  ['Redeemed today', visibleActivityMetrics.today.redeemed],
                  ['All redemptions', visibleActivityMetrics.allTime.redeemed],
                  ['Open checks', visibleActivityMetrics.openChecks],
                  ['Approval rate', visibleActivityMetrics.approvalRatePercent === null ? 'No data' : `${visibleActivityMetrics.approvalRatePercent}%`],
                ].map(([metricLabel, value]) => (
                  <div key={metricLabel} className="rounded-2xl border border-white/10 bg-black/20 p-3">
                    <p className="text-xs uppercase tracking-[0.12em] text-stone-400">{metricLabel}</p>
                    <p className="mt-2 text-2xl font-black text-white">{value}</p>
                  </div>
                ))}
              </div>
              <p className="mt-3 text-xs leading-5 text-stone-400">
                {visibleActivityMetrics.today.checks} check{visibleActivityMetrics.today.checks === 1 ? '' : 's'} today / {visibleActivityMetrics.allTime.checks} all time. Approval rate counts approved or redeemed checks against completed approved, redeemed and rejected checks; expired QR sessions are excluded.
              </p>
            </div>
          ) : (
            <div className="mt-4 rounded-2xl border border-white/10 bg-black/20 p-4">
              <p className="text-xs font-black uppercase tracking-[0.16em] text-stone-400">Seller activity</p>
              <p className="mt-2 text-sm leading-6 text-stone-300">
                Connect the owner wallet and load sessions to view redemptions, open checks and approval rate.
              </p>
            </div>
          )}
        </div>
        ) : (
          <div className="mb-5 rounded-3xl border border-green-300/20 bg-green-300/[0.06] p-4">
            <p className="text-xs font-bold uppercase tracking-[0.18em] text-green-100/80">Session history</p>
            <h3 className="mt-1 text-xl font-black text-white">Review and export customer checks</h3>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              Connect the seller owner wallet and create or load its seller profile first. The owner-only history then provides recent checkout status, masked wallets, activity metrics and a browser-local masked CSV export.
            </p>
          </div>
        )}
      </div>

      <SellerCatalogManager
        businessId={businessId}
        publicBusinessRef={publicBusinessRef}
        ownerReady={canUseWalletOwner}
        products={catalogProducts}
        signSellerAction={signSellerAction}
        onProductsChange={setCatalogProducts}
        onUseProduct={useCatalogProduct}
        onProductArchived={(productId) => {
          setRules((current) => current.map((rule) => rule.productId === productId ? { ...rule, active: false } : rule));
          if (selectedProductId === productId) setSelectedProductId('');
          setPublicListing(null);
        }}
      />

      <div id="seller-rule-editor" className="mb-4 scroll-mt-24 rounded-2xl border border-orange-200/20 bg-orange-200/[0.06] p-4">
        <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">
          {editingRule ? 'Editing benefit rule' : 'New benefit rule'}
        </p>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm leading-6 text-stone-300">
            {editingRule
              ? `${editingRule.label} is ${editingRule.active ? 'active' : 'paused'}. Updating details preserves that state.`
              : 'Create a checkout benefit or select Edit on a saved rule to update it.'}
          </p>
          {editingRule ? (
            <button
              type="button"
              onClick={cancelRuleEdit}
              disabled={loading}
              className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-stone-100 transition hover:border-orange-200/60 disabled:opacity-50"
            >
              Cancel edit
            </button>
          ) : null}
        </div>
      </div>

      <div id="seller-rule-templates" className="mb-5 scroll-mt-24 border-y border-white/10 py-4">
        <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div className="w-full min-w-0 sm:flex-1">
            <p className="text-xs font-black uppercase tracking-[0.16em] text-green-100/80">Quick rule templates</p>
            <p id="seller-rule-template-help" className="mt-1 max-w-full break-words pr-4 text-sm leading-6 text-stone-300 sm:pr-0">
              Apply a starting point, review every value,<br className="sm:hidden" /> then save through the normal authorization flow.
            </p>
          </div>
          <span className="text-xs font-semibold text-stone-500">Draft only</span>
        </div>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
          {ruleTemplates.map((template) => (
            <button
              key={template.name}
              type="button"
              onClick={() => applyRuleTemplate(template)}
              disabled={loading}
              className="min-h-24 border-l-2 border-green-200/35 bg-green-200/[0.05] px-4 py-3 text-left transition hover:border-green-200/70 hover:bg-green-200/[0.09] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <span className="block text-sm font-black text-green-50">{template.name}</span>
              <span className="mt-1 block text-xs leading-5 text-stone-400">{template.detail}</span>
              <span className="mt-2 block text-xs font-bold text-orange-100">
                {template.discount}% / {template.minLocked.toLocaleString('en-US')} IFR
              </span>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-[1fr_auto]">
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Business ID
          <input
            value={businessId}
            onChange={(event) => {
              setActiveBusinessId(event.target.value);
              setRules([]);
              setSessions([]);
              setActivityMetrics(null);
            }}
            placeholder="cuid..."
            disabled={loading}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        <button
          type="button"
          onClick={loadRules}
          disabled={loading}
          className="self-end rounded-2xl border border-orange-200/40 px-5 py-3 text-sm font-black uppercase tracking-[0.14em] text-orange-100 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Load
        </button>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-stone-200 md:col-span-2">
          Catalog binding
          <select
            value={selectedProductId}
            onChange={(event) => {
              const productId = event.target.value;
              setSelectedProductId(productId);
              const productItem = catalogProducts.find((item) => item.id === productId);
              if (productItem) {
                setProduct(productItem.name);
                setCategory(productItem.category);
              }
            }}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          >
            <option value="">Custom rule without catalog item</option>
            {catalogProducts.filter((item) => item.active).map((item) => (
              <option key={item.id} value={item.id}>{item.category} / {item.name}</option>
            ))}
          </select>
          <span className="text-xs font-normal leading-5 text-stone-400">
            Bound rules copy the current catalog name and category into each new checkout snapshot.
          </span>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Rule label
          <input
            value={label}
            onChange={(event) => setLabel(event.target.value)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Category
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            disabled={Boolean(selectedProductId)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          >
            {categories.map((item) => (
              <option key={item}>{item}</option>
            ))}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Product or service
          <input
            value={product}
            onChange={(event) => setProduct(event.target.value)}
            readOnly={Boolean(selectedProductId)}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Discount: {discount}%
          <input
            type="range"
            min="1"
            max="50"
            value={discount}
            onChange={(event) => setDiscount(Number(event.target.value))}
            className="accent-orange-400"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Minimum locked IFR
          <input
            type="number"
            min="1"
            value={minLocked}
            onChange={(event) => setMinLocked(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Accepted lock source
          <select
            aria-label="Accepted lock source"
            value={lockSource}
            onChange={(event) => {
              if (isLockSource(event.target.value)) setLockSource(event.target.value);
            }}
            className="rounded-2xl border border-white/10 bg-stone-950 px-4 py-3 text-white outline-none focus:border-orange-300"
          >
            <option value="ifrlock">IFRLock - simple access lock</option>
            <option value="commitment_time_only">CommitmentVault - TIME_ONLY only</option>
            <option value="either">Either source - full amount in one source</option>
          </select>
          <span className="text-xs font-normal leading-5 text-stone-400">
            Either source never combines partial balances. PRICE_ONLY, TIME_OR_PRICE and TIME_AND_PRICE commitments do not qualify.
          </span>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Minimum IFR kept in wallet
          <input
            type="number"
            min="0"
            max="1000000000"
            step="1"
            value={minHeld}
            onChange={(event) => setMinHeld(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
          <span className="text-xs font-normal leading-5 text-stone-400">
            Optional. Use 0 for lock-only access. A positive value additionally requires this free wallet balance.
          </span>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          QR session TTL
          <input
            type="number"
            min="10"
            max="3600"
            value={ttl}
            onChange={(event) => setTtl(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Uses per wallet / UTC day
          <input
            type="number"
            min="0"
            max="1000"
            value={dailyLimit}
            onChange={(event) => setDailyLimit(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
          <span className="text-xs font-normal text-stone-400">0 means unlimited.</span>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Uses per wallet / UTC month
          <input
            type="number"
            min="0"
            max="10000"
            value={monthlyLimit}
            onChange={(event) => setMonthlyLimit(Number(event.target.value))}
            className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300"
          />
          <span className="text-xs font-normal text-stone-400">0 means unlimited.</span>
        </label>
      </div>

      <div className="mt-5 rounded-2xl border border-white/10 bg-black/25 p-4">
        <p className="text-xs uppercase tracking-[0.14em] text-stone-400">Customer result</p>
        <p className="mt-2 text-xl font-black text-orange-100">
          {discount}% off when {minLocked.toLocaleString('en-US')} IFR is locked {lockSourceRequirement(lockSource)}
          {minHeld > 0 ? ` and ${minHeld.toLocaleString('en-US')} IFR stays in the wallet` : ''}
        </p>
        <p className="mt-2 text-sm text-stone-300">{label} / {category} / {product}</p>
        <p className="mt-2 text-xs text-stone-400">
          Per wallet: {dailyLimit || 'unlimited'} / UTC day and {monthlyLimit || 'unlimited'} / UTC month.
        </p>
      </div>

      <button
          type="button"
          onClick={saveRule}
        disabled={loading || !canManageSelectedBusiness}
        className="mt-5 w-full rounded-2xl bg-orange-300 px-5 py-4 text-sm font-black uppercase tracking-[0.16em] text-stone-950 shadow-xl shadow-orange-950/40 transition hover:bg-orange-200 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {loading ? 'Working...' : editingRule ? 'Update rule' : 'Save new rule'}
      </button>

      {rules.length > 0 ? (
        <div className="mt-5 grid gap-3">
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-stone-400">
            Saved rules
          </p>
          {rules.map((rule) => (
            <div key={rule.id} className="rounded-2xl border border-white/10 bg-black/25 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-lg font-black text-white">{rule.label}</p>
                  <p className="mt-1 text-sm text-stone-300">
                    {rule.category} / {rule.productName}
                  </p>
                  <p className="mt-2 text-sm text-orange-100">
                    {rule.discountPercent}% off at {rule.requiredLockIFR.toLocaleString('en-US')} locked IFR
                    {' '}{lockSourceRequirement(rule.lockSource)}
                    {rule.minIFRHeld > 0
                      ? ` plus ${rule.minIFRHeld.toLocaleString('en-US')} IFR held`
                      : ''}
                  </p>
                  <p className="mt-1 text-xs text-stone-400">
                    Per wallet: {rule.dailyRedemptionLimit || 'unlimited'} / UTC day and {rule.monthlyRedemptionLimit || 'unlimited'} / UTC month
                  </p>
                </div>
                <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.14em] ${rule.active ? 'bg-green-400/15 text-green-100' : 'bg-stone-500/20 text-stone-300'}`}>
                  {rule.active ? 'Active' : 'Paused'}
                </span>
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => beginRuleEdit(rule)}
                  disabled={loading || !canManageSelectedBusiness}
                  className="rounded-full border border-orange-200/35 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-orange-100 transition hover:bg-orange-200/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Edit
                </button>
                <button
                  type="button"
                  onClick={() => toggleRule(rule)}
                  disabled={loading || !canManageSelectedBusiness}
                  className="rounded-full border border-white/15 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-stone-100 hover:border-orange-200/60 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {rule.active ? 'Pause' : 'Activate'}
                </button>
                <button
                  type="button"
                  onClick={() => archiveRule(rule.id)}
                  disabled={loading || !canManageSelectedBusiness}
                  className="rounded-full border border-red-300/30 px-4 py-2 text-xs font-bold uppercase tracking-[0.12em] text-red-100 hover:bg-red-500/10 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Archive
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : null}
        </>
      ) : (
        <>
          {['seller-catalog', 'seller-rule-editor', 'seller-team', 'seller-session-history', 'seller-rewards'].map((targetId) => (
            <span key={targetId} id={targetId} className="block scroll-mt-28" aria-hidden="true" />
          ))}
          <div data-seller-profile-gate className="rounded-3xl border border-orange-200/20 bg-[#1d130c] p-4">
            <p className="text-xs font-black uppercase tracking-[0.18em] text-orange-200/80">Seller workspace</p>
            <h3 className="mt-1 text-xl font-black text-white">Finish the seller profile first</h3>
            <p className="mt-2 text-sm leading-6 text-stone-300">
              Create a wallet-owned profile or restore and load an existing setup. Products, benefit rules, checkout tools, team access, history and rewards then become available for that exact seller.
            </p>
            <a
              href="#seller-profile"
              className="mt-4 inline-flex rounded-2xl bg-orange-300 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950 shadow-xl shadow-orange-950/30 transition hover:bg-orange-200"
            >
              Continue seller profile
            </a>
          </div>
        </>
      )}
    </section>
  );
}
