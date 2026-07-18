'use client';

import { useEffect, useState } from 'react';
import {
  CatalogProduct,
  SellerAuth,
  createSellerBusinessProduct,
  deleteSellerBusinessProduct,
  getSellerBusinessProducts,
  updateSellerBusinessProduct,
} from '@/lib/api';

const productCategories = ['Coffee', 'Retail', 'Digital access', 'Events', 'Services'];

interface SellerCatalogManagerProps {
  businessId: string;
  ownerReady: boolean;
  products: CatalogProduct[];
  signSellerAction: (action: string, businessId: string, scope?: string) => Promise<SellerAuth>;
  onProductsChange: (products: CatalogProduct[]) => void;
  onUseProduct: (product: CatalogProduct) => void;
  onProductArchived: (productId: string) => void;
}

export function SellerCatalogManager({
  businessId,
  ownerReady,
  products,
  signSellerAction,
  onProductsChange,
  onUseProduct,
  onProductArchived,
}: SellerCatalogManagerProps) {
  const [name, setName] = useState('Premium customer service');
  const [category, setCategory] = useState(productCategories[0]);
  const [description, setDescription] = useState('Available to customers with verified locked IFR.');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setEditingId(null);
    setStatus('');
    setError('');
  }, [businessId]);

  function resetDraft() {
    setName('Premium customer service');
    setCategory(productCategories[0]);
    setDescription('Available to customers with verified locked IFR.');
    setEditingId(null);
  }

  async function loadProducts() {
    if (!businessId || !ownerReady) {
      setError('Select a seller profile and connect its owner wallet to load the catalog.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await getSellerBusinessProducts(
        businessId,
        await signSellerAction('products:list', businessId)
      );
      onProductsChange(result.products);
      setStatus(`Loaded ${result.products.length} product${result.products.length === 1 ? '' : 's'} or service${result.products.length === 1 ? '' : 's'}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load seller catalog');
    } finally {
      setLoading(false);
    }
  }

  async function saveProduct() {
    if (!businessId || !ownerReady) {
      setError('Select a seller profile and connect its owner wallet before editing the catalog.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const input = { name: name.trim(), category, description: description.trim() || null };
      const product = editingId
        ? await updateSellerBusinessProduct(
            editingId,
            await signSellerAction('products:update', businessId, editingId),
            input
          )
        : await createSellerBusinessProduct(
            businessId,
            await signSellerAction('products:create', businessId, businessId),
            input
          );
      const next = editingId
        ? products.map((item) => item.id === product.id ? product : item)
        : [product, ...products];
      onProductsChange(next);
      resetDraft();
      setStatus(editingId ? 'Catalog item updated. Existing checkout snapshots remain unchanged.' : 'Catalog item created. It can now be linked to a benefit rule.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save catalog item');
    } finally {
      setLoading(false);
    }
  }

  function beginEdit(product: CatalogProduct) {
    setEditingId(product.id);
    setName(product.name);
    setCategory(product.category);
    setDescription(product.description || '');
    setError('');
    setStatus('Editing catalog item. Existing checkout rule snapshots update only when that rule is saved again.');
  }

  async function archiveProduct(product: CatalogProduct) {
    if (!businessId || !ownerReady) return;
    setLoading(true);
    setError('');
    try {
      await deleteSellerBusinessProduct(
        product.id,
        await signSellerAction('products:delete', businessId, product.id)
      );
      onProductsChange(products.map((item) => item.id === product.id ? { ...item, active: false } : item));
      onProductArchived(product.id);
      if (editingId === product.id) resetDraft();
      setStatus('Catalog item archived. Its linked offers are paused; prior receipts and sessions remain available.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to archive catalog item');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mb-5 border-y border-orange-200/15 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-black uppercase tracking-[0.16em] text-orange-200/80">Seller catalog</p>
          <h3 className="mt-1 text-xl font-black text-white">Products and services</h3>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-stone-300">
            Maintain customer-facing items once, then bind benefit rules to them. Archiving pauses linked offers without deleting checkout history.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={loadProducts}
            disabled={loading || !businessId || !ownerReady}
            className="rounded-full border border-orange-200/35 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-orange-50 disabled:opacity-50"
          >
            Load catalog
          </button>
          {businessId ? (
            <a
              href={`/s/${encodeURIComponent(businessId)}`}
              className="rounded-full border border-green-200/35 px-4 py-2 text-xs font-black uppercase tracking-[0.12em] text-green-50"
            >
              Customer view
            </a>
          ) : null}
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Product or service name
          <input value={name} onChange={(event) => setName(event.target.value)} className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300" />
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200">
          Category
          <select value={category} onChange={(event) => setCategory(event.target.value)} className="rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300">
            {productCategories.map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="grid gap-2 text-sm font-semibold text-stone-200 md:col-span-2">
          Short customer description
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} maxLength={500} rows={3} className="resize-y rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-white outline-none focus:border-orange-300" />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" onClick={saveProduct} disabled={loading || !ownerReady || !businessId || !name.trim()} className="rounded-2xl bg-orange-300 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-950 disabled:opacity-50">
          {editingId ? 'Update item' : 'Add item'}
        </button>
        {editingId ? (
          <button type="button" onClick={resetDraft} disabled={loading} className="rounded-2xl border border-white/15 px-5 py-3 text-xs font-black uppercase tracking-[0.14em] text-stone-100">
            Cancel edit
          </button>
        ) : null}
      </div>

      {products.length > 0 ? (
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {products.map((product) => (
            <article key={product.id} className={`border-l-2 p-4 ${product.active ? 'border-green-300 bg-green-300/[0.05]' : 'border-stone-600 bg-black/20'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-bold uppercase tracking-[0.12em] text-stone-400">{product.category}</p>
                  <h4 className="mt-1 text-lg font-black text-white">{product.name}</h4>
                </div>
                <span className="text-xs font-bold uppercase tracking-[0.12em] text-stone-400">{product.active ? 'Active' : 'Archived'}</span>
              </div>
              {product.description ? <p className="mt-2 text-sm leading-6 text-stone-300">{product.description}</p> : null}
              <p className="mt-2 text-xs text-stone-500">{product._count?.benefitRules ?? 0} linked rule{product._count?.benefitRules === 1 ? '' : 's'}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                {product.active ? (
                  <button type="button" onClick={() => onUseProduct(product)} className="rounded-full border border-green-200/35 px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-green-50">Use in rule</button>
                ) : null}
                {product.active ? (
                  <button type="button" onClick={() => beginEdit(product)} disabled={loading} className="rounded-full border border-white/15 px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-stone-100 disabled:opacity-50">Edit</button>
                ) : null}
                {product.active ? (
                  <button type="button" onClick={() => archiveProduct(product)} disabled={loading} className="rounded-full border border-red-300/30 px-3 py-2 text-[11px] font-black uppercase tracking-[0.1em] text-red-100 disabled:opacity-50">Archive</button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="mt-4 border-l-2 border-stone-700 pl-4 text-sm leading-6 text-stone-400">No catalog loaded yet. Connect the owner wallet and load or add the first product or service.</p>
      )}
      {status ? <p className="mt-4 text-sm text-green-100">{status}</p> : null}
      {error ? <p className="mt-4 text-sm text-red-200">{error}</p> : null}
    </section>
  );
}
