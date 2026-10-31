import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useRoute } from "wouter";
import { ArrowDownRight, ArrowLeft, ArrowRight, BadgeCheck, Check, ChevronDown, Clock3, Heart, Instagram, Mail, MapPin, Minus, PackageCheck, Plus, Search, ShieldCheck, ShoppingBag, SlidersHorizontal, Sparkles, Star, Truck, UserRound, X } from "lucide-react";
import { Breadcrumb, PageIntro, Pill, ProductCard, SectionHeading, TrustStrip } from "@/components/store/StoreShell";
import { money, products, useStore, type Product } from "@/store";
import { useTheme } from "@/contexts/ThemeContext";
import { trpc } from "@/lib/trpc";
import { startLogin } from "@/const";
import { clearCheckoutIdempotencyKeys, getCheckoutIdempotencyKey } from "@/lib/checkout-idempotency";

const heroImage = "/naijakoblas-hero.jpg";

function NewsletterBand({ compact = false }: { compact?: boolean }) {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  return <section className={`newsletter-band ${compact ? "newsletter-band--compact" : ""}`}><div><span className="eyebrow">Join those already on the list</span><h2>{compact ? "First access, always." : <>Be the first <em>to know.</em></>}</h2><p>Free to join. First access when we launch.</p></div><form onSubmit={(event) => { event.preventDefault(); if (email) setSent(true); }}><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email address" /> <button className="button button--dark">{sent ? "You're on the list" : "Join Early Access"}<ArrowRight size={17} /></button></form></section>;
}

export function HomePage() {
  const { addToCart, catalogProducts, catalogLoading, catalogError } = useStore();
  const featured = catalogProducts[0];
  return <main>
    <section className="hero container-wide"><div className="hero-copy"><Pill tone="lime">Authentic African Craftsmanship</Pill><h1>Leather Goods<br /><em>Made with Nigerian<br />Heritage.</em></h1><p>Discover handcrafted leather shoes, bags, belts, and accessories published by approved sellers across Nigeria.</p><div className="hero-actions"><Link className="button button--dark" href="/products">Shop Collection <ArrowRight size={17} /></Link><Link className="button button--outline" href="/about">Our Story <ArrowDownRight size={17} /></Link></div><div className="hero-stats"><div><strong>Reviewed</strong><span>Seller applications</span></div><div><strong>NGN</strong><span>Server-priced checkout</span></div><div><strong>Order status</strong><span>Visible in your account</span></div></div></div><div className="hero-visual"><img src={heroImage} alt="Nigerian artisan leather collection" /><div className="hero-stamp"><span>NK</span><small>AUTHENTIC<br />CRAFT</small></div><div className="hero-caption"><span>01</span><strong>Handcrafted<br />in Nigeria</strong></div></div></section>
    <TrustStrip />
    <section className="section home-catalog"><div className="container-wide"><SectionHeading eyebrow="Browse by Type" title="Shop by Category" /><div className="home-category-tabs">{["All", "Shoes", "Bags", "Belts", "Accessories"].map(category => <Link key={category} className={category === "All" ? "active" : ""} href={category === "All" ? "/products" : `/products?category=${encodeURIComponent(category)}`}>{category}</Link>)}</div>{catalogLoading ? <p className="catalog-status">Loading published artisan products…</p> : catalogError ? <p className="portal-error">The live catalog is temporarily unavailable. Please try again shortly.</p> : catalogProducts.length ? <div className="product-grid product-grid--featured">{catalogProducts.slice(0, 4).map((product) => <ProductCard key={product.id} product={product} />)}</div> : <div className="empty-state"><h3>Our artisan collection is getting ready.</h3><p>Published seller products will appear here as vendors complete their listings.</p><Link className="button button--outline" href="/vendor">Become a Vendor</Link></div>}<Link href="/products" className="home-view-all">View All Products <ArrowRight size={15} /></Link></div></section>
    {featured && <section className="spotlight section container-wide"><div className="spotlight-image"><img src={featured.image} alt={featured.name} /><span className="vertical-label">ARTISAN SPOTLIGHT</span></div><div className="spotlight-copy"><span className="eyebrow">Featured Collection</span><span className="spotlight-location">{featured.experience ?? "Made in Nigeria"}</span><h2>{featured.name}</h2><p>Made by {featured.maker} <span className="verified"><span>✓</span> Verified seller</span></p><p className="spotlight-detail">{featured.description}</p><strong className="spotlight-price">{money(featured.price)}</strong><div className="spotlight-actions"><button className="button button--dark" onClick={() => addToCart(featured.id, featured.sizes[0])}>Add to Cart <ShoppingBag size={15} /></button><Link className="button button--outline" href={`/products/${featured.id}`}>View Details <ArrowRight size={17} /></Link></div></div></section>}
    <NewsletterBand />
  </main>;
}

function ArrowUpRight() { return <ArrowRight className="arrow-up-right" size={21} />; }

function ProductGallery({ product }: { product: Product }) {
  const images = product.images?.length ? product.images : [product.image];
  const [activeImage, setActiveImage] = useState(images[0] ?? product.image);
  useEffect(() => setActiveImage(images[0] ?? product.image), [product.id, product.image, images[0]]);
  return <div className="detail-gallery">
    <div className="detail-image"><img src={activeImage} alt={product.name} /></div>
    {images.length > 1 && <div className="detail-thumbnails" aria-label={`${images.length} product photos`}>
      {images.map((image, index) => <button key={`${image}-${index}`} type="button" className={activeImage === image ? "selected" : ""} aria-label={`Show product photo ${index + 1}`} aria-pressed={activeImage === image} onClick={() => setActiveImage(image)}><img src={image} alt="" loading="lazy" /></button>)}
    </div>}
  </div>;
}

export function ProductsPage() {
  const [, navigate] = useLocation();
  const { catalogProducts, catalogLoading, catalogError } = useStore();
  const params = new URLSearchParams(window.location.search);
  const initialCategory = params.get("category") ?? "All";
  const [category, setCategory] = useState(initialCategory);
  const [search, setSearch] = useState("");
  const [showFilters, setShowFilters] = useState(false);
  const filterTriggerRef = useRef<HTMLButtonElement | null>(null);
  const filterCloseRef = useRef<HTMLButtonElement | null>(null);
  const filterSidebarRef = useRef<HTMLElement | null>(null);
  const [priceFloor, setPriceFloor] = useState(0);
  const [priceCeiling, setPriceCeiling] = useState(200000);
  const categories = ["All", ...new Set(catalogProducts.map(product => product.category))];
  const visible = useMemo(() => catalogProducts
    .filter((product) => category === "All" || product.category === category)
    .filter((product) => `${product.name} ${product.maker}`.toLowerCase().includes(search.toLowerCase()))
    .filter((product) => product.price >= priceFloor && product.price <= priceCeiling), [catalogProducts, category, search, priceFloor, priceCeiling]);
  const selectCategory = (value: string) => {
    setCategory(value);
    navigate(value === "All" ? "/products" : `/products?category=${value}`);
  };
  const clearFilters = () => {
    setCategory("All"); setSearch(""); setPriceFloor(0); setPriceCeiling(200000); navigate("/products");
  };
  const closeFilters = () => {
    setShowFilters(false);
    window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
  };
  useEffect(() => {
    if (!showFilters) return;
    const sidebar = filterSidebarRef.current;
    if (!sidebar) return;
    document.body.classList.add("filter-drawer-open");
    const focusFrame = window.requestAnimationFrame(() => filterCloseRef.current?.focus());
    const close = () => {
      setShowFilters(false);
      window.requestAnimationFrame(() => filterTriggerRef.current?.focus());
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        close();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(sidebar.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )).filter(element => element.getClientRects().length > 0);
      if (!focusable.length) return;
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      const focusIsOutside = !sidebar.contains(document.activeElement);
      if (event.shiftKey && (focusIsOutside || document.activeElement === first)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (focusIsOutside || document.activeElement === last)) {
        event.preventDefault();
        first.focus();
      }
    };
    const onResize = () => {
      if (window.innerWidth <= 640) return;
      setShowFilters(false);
      window.requestAnimationFrame(() => sidebar.querySelector<HTMLElement>("input")?.focus());
    };
    document.addEventListener("keydown", onKeyDown);
    window.addEventListener("resize", onResize);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("resize", onResize);
      document.body.classList.remove("filter-drawer-open");
    };
  }, [showFilters]);
  return <main className="catalog-page">
    <section className="catalog-page-head container-wide"><Breadcrumb items={["Home", "Products"]} /><h1>All Products</h1></section>
    <section className="catalog-layout container-wide">
      <aside id="product-filter-panel" ref={filterSidebarRef} className={`filter-sidebar ${showFilters ? "filter-sidebar--open" : ""}`} role={showFilters ? "dialog" : "region"} aria-labelledby="filter-drawer-title" aria-modal={showFilters ? "true" : undefined} onClick={event => { if (event.target === event.currentTarget && showFilters) closeFilters(); }}>
        <div className="filter-mobile-heading"><strong id="filter-drawer-title">Filters</strong><button ref={filterCloseRef} type="button" aria-label="Close filters" onClick={closeFilters}><X size={20} /></button></div>
        <label className="sidebar-field"><span>Search</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search products..." /></label>
        <div className="sidebar-section"><span>Category</span>{categories.map((item) => <button key={item} className={`sidebar-category ${category === item ? "active" : ""}`} onClick={() => selectCategory(item)}><i>{category === item ? "✓" : ""}</i>{item === "All" ? "All Products" : item === "Bags" ? "Bags & Totes" : item}</button>)}</div>
        <div className="sidebar-section"><span>Price Range</span><div className="sidebar-price"><input aria-label="Minimum price" type="number" min="0" value={priceFloor || ""} placeholder="Min" onChange={(event) => setPriceFloor(Math.min(Number(event.target.value) || 0, priceCeiling))} /><b>—</b><input aria-label="Maximum price" type="number" min="0" value={priceCeiling === 200000 ? "" : priceCeiling} placeholder="Max" onChange={(event) => setPriceCeiling(Math.max(Number(event.target.value) || 200000, priceFloor))} /></div></div>
        <button className="apply-filter-button" onClick={closeFilters}>Apply Filters</button>
        <button className="sidebar-clear" onClick={clearFilters}>Clear Filters</button>
      </aside>
      <div className="catalog-results"><div className="catalog-results-heading"><span>Showing <b>{visible.length}</b> products</span><button ref={filterTriggerRef} type="button" className="catalog-filter-trigger" aria-expanded={showFilters} aria-controls="product-filter-panel" onClick={() => setShowFilters(true)}><SlidersHorizontal size={17} /> Filters</button></div>{catalogLoading ? <p className="catalog-status">Loading published artisan products…</p> : catalogError ? <p className="portal-error">The live catalog is temporarily unavailable. Please try again shortly.</p> : <div className="product-grid">{visible.map((product) => <ProductCard key={product.id} product={product} />)}</div>}{!catalogLoading && !catalogError && visible.length === 0 && <div className="empty-state"><Search size={26} /><h3>No published pieces found</h3><p>Try a different search or browse all available products.</p><button className="button button--dark" onClick={clearFilters}>View all products</button></div>}</div>
    </section>
  </main>;
}

export function ProductDetailPage() {
  const [, params] = useRoute("/products/:id");
  const { addToCart, wishlist, toggleWishlist, catalogProducts, catalogLoading, catalogError } = useStore();
  const product = catalogProducts.find((item) => item.id === params?.id);
  const [size, setSize] = useState(product?.sizes[0] ?? "");
  const [quantity, setQuantity] = useState(1);
  const [added, setAdded] = useState(false);
  useEffect(() => { setSize(product?.sizes[0] ?? ""); setQuantity(1); setAdded(false); }, [product?.id]);
  if (catalogLoading) return <main><PageIntro eyebrow="Product" title="Loading this artisan piece…" /></main>;
  if (catalogError) return <main><PageIntro eyebrow="Catalog unavailable" title="We can’t load this piece right now." copy="Please try again shortly." /><div className="empty-state container-wide"><Link className="button button--dark" href="/products">Browse Products <ArrowRight size={17} /></Link></div></main>;
  if (!product) return <main><PageIntro eyebrow="Not found" title="This piece has moved on." copy="The product is unavailable, out of stock, or no longer published by its seller." /><div className="empty-state container-wide"><Link className="button button--dark" href="/products">Browse Products <ArrowRight size={17} /></Link></div></main>;
  const saved = wishlist.includes(product.id);
  return <main><Breadcrumb items={["Home", "Products", product.name]} /><section className="product-detail container-wide"><ProductGallery product={product} /><div className="detail-copy"><span className="eyebrow">{product.category}</span><h1>{product.name}</h1><div className="detail-maker">by {product.maker} <span className="verified"><span>✓</span> Approved seller</span></div><strong className="spotlight-price">{money(product.price)}</strong><p className="detail-description">{product.description}</p><div className="detail-rule" /><div className="selector-block"><div className="selector-label"><span>Size / style</span></div><div className="size-options">{product.sizes.map((item) => <button key={item} className={item === size ? "selected" : ""} onClick={() => setSize(item)}>{item}</button>)}</div></div><div className="detail-actions"><div className="detail-quantity"><span className="quantity-label">QUANTITY</span><div className="quantity-control"><button onClick={() => setQuantity(value => Math.max(1, value - 1))}><Minus size={15} /></button><span>{quantity}</span><button disabled={quantity >= Math.min(product.inventoryCount ?? 20, 20)} onClick={() => setQuantity(value => Math.min(value + 1, product.inventoryCount ?? 20, 20))}><Plus size={15} /></button></div></div><button className="button button--dark button--wide" disabled={!size || !product.inventoryCount || quantity > product.inventoryCount} onClick={() => { for (let i = 0; i < quantity; i++) addToCart(product.id, size); setAdded(true); }}>{added ? "Added to Cart" : "Add to Cart"}<ShoppingBag size={17} /></button><button className={`wishlist-detail ${saved ? "saved" : ""}`} onClick={() => toggleWishlist(product.id)} aria-label="Wishlist"><Heart size={20} fill={saved ? "currentColor" : "none"} /></button></div><div className="stock-note"><Check size={16} /> {product.inventoryCount} available · seller-fulfilled delivery</div><div className="shipping-note"><Truck size={17} /><span>Shipping is calculated by the server at checkout.<br /><small>{product.experience ?? "Made by an approved Nigerian seller"}</small></span></div><div className="maker-card"><div className="maker-avatar">{product.maker.slice(0, 2).toUpperCase()}</div><div><strong>{product.maker}</strong><span>{product.experience ?? "NaijaKoblas seller"}</span><p>Sold by an approved NaijaKoblas marketplace seller.</p></div><ArrowRight size={18} /></div></div></section><section className="section section--tint detail-story"><div className="container-wide"><SectionHeading eyebrow="The Details" title="Crafted to go the distance." /><div className="detail-values"><div><ShieldCheck size={24} /><h3>Authentic materials</h3><p>Product details are supplied by the seller.</p></div><div><Sparkles size={24} /><h3>Made by people</h3><p>Every listing is tied to its approved maker.</p></div><div><Truck size={24} /><h3>Ready to travel</h3><p>Fulfilment starts after verified payment.</p></div></div></div></section></main>;
}

export function CartPage() {
  const [, navigate] = useLocation();
  const { cart, catalogProducts, catalogLoading, subtotal, shipping, total, updateQuantity, removeFromCart } = useStore();
  const unavailable = cart.some(line => !catalogProducts.some(product => product.id === line.productId));
  if (!cart.length) return <main><section className="empty-cart-reference container-wide"><ShoppingBag size={32} /><h1>Your cart is empty</h1><p>Add an available artisan listing to get started.</p><Link className="button button--dark" href="/products">Browse Products <ArrowRight size={17} /></Link></section></main>;
  return <main><PageIntro eyebrow="Your selection" title="Shopping Cart" copy={`${cart.reduce((sum, line) => sum + line.quantity, 0)} items in your cart`} /><section className="cart-layout container-wide"><div className="cart-lines">{cart.map((line) => {
    const product = catalogProducts.find(item => item.id === line.productId);
    return <article className="cart-line" key={`${line.productId}-${line.size}`}>
      {product ? <Link href={`/products/${product.id}`} className="cart-line-image"><img src={product.image} alt={product.name} /></Link> : <div className="cart-line-image"><PackageCheck size={24} /></div>}
      <div className="cart-line-copy"><div>{product ? <Link href={`/products/${product.id}`}><h3>{product.name}</h3></Link> : <h3>Listing no longer available</h3>}<p>{product ? `by ${product.maker}` : "Remove this item before checkout."}</p><span>Size: {line.size}</span></div><strong>{product ? money(product.price * line.quantity) : "Unavailable"}</strong><div className="cart-line-controls">{product && <div className="quantity-control"><button onClick={() => updateQuantity(line.productId, line.size, line.quantity - 1)}><Minus size={14} /></button><span>{line.quantity}</span><button disabled={line.quantity >= Math.min(product.inventoryCount ?? 20, 20)} onClick={() => updateQuantity(line.productId, line.size, line.quantity + 1)}><Plus size={14} /></button></div>}<button className="remove-button" onClick={() => removeFromCart(line.productId, line.size)}><X size={15} /> Remove</button></div>
    </div></article>;
  })}</div><aside className="summary-card"><h2>Order Summary</h2><div><span>Subtotal</span><strong>{money(subtotal)}</strong></div><div><span>Shipping estimate</span><strong>{shipping === 0 ? "Free" : money(shipping)}</strong></div><div className="summary-total"><span>Estimated total</span><strong>{money(total)}</strong></div>{unavailable && <p className="portal-error">Remove unavailable items to continue.</p>}{catalogLoading && <p className="catalog-status">Refreshing prices and availability…</p>}<button className="button button--dark button--full" disabled={unavailable || catalogLoading || subtotal <= 0} onClick={() => navigate("/checkout")}>Proceed to Checkout <ArrowRight size={17} /></button><div className="summary-assurance"><ShieldCheck size={18} /><span>Paystack hosted checkout<br /><small>The server recalculates prices, stock and delivery before redirect.</small></span></div></aside></section></main>;
}

export function CheckoutPage() {
  const { cart, catalogProducts, catalogLoading, subtotal, shipping } = useStore();
  const auth = trpc.auth.me.useQuery(undefined, { retry: false });
  const account = trpc.account.me.useQuery(undefined, { enabled: Boolean(auth.data), retry: false });
  const checkout = trpc.orders.createCheckout.useMutation();
  const [delivery, setDelivery] = useState<"standard" | "express">(() => new URLSearchParams(window.location.search).get("delivery") === "express" ? "express" : "standard");
  const [error, setError] = useState<string | null>(null);
  const cancelledCheckout = new URLSearchParams(window.location.search).get("cancelled") === "true";
  const deliveryCharge = delivery === "express" ? 7500 : shipping;
  const checkoutTotal = subtotal + deliveryCharge;
  const missingLine = cart.some(line => !catalogProducts.some(product => product.id === line.productId));
  if (catalogLoading || auth.isLoading || (auth.data && account.isLoading)) return <main><PageIntro eyebrow="Checkout" title="Preparing secure checkout…" /></main>;
  if (!auth.data) return <main><PageIntro eyebrow="Secure checkout" title="Sign in to place an order." copy="Your order and payment status will be tied to your authenticated customer account." /><div className="empty-state container-wide"><button className="button button--dark" onClick={() => startLogin()}>Sign in securely <ArrowRight size={17} /></button></div></main>;
  if (account.error) return <main><PageIntro eyebrow="Account unavailable" title="We could not load your saved checkout details." copy="Refresh the page or sign in again." /></main>;
  if (!cart.length) return <main><PageIntro eyebrow="Checkout" title="Nothing to check out yet." /><div className="empty-state container-wide"><Link className="button button--dark" href="/products">Continue Shopping</Link></div></main>;
  const profile = account.data?.profile;
  const submitCheckout = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    if (missingLine || cart.length > 30 || cart.some(line => line.quantity > 20)) {
      setError("Please review your cart. It contains an unavailable listing or exceeds checkout limits.");
      return;
    }
    const form = new FormData(event.currentTarget);
    const customer = {
      firstName: String(form.get("firstName") ?? "").trim(),
      lastName: String(form.get("lastName") ?? "").trim(),
      email: String(form.get("email") ?? "").trim(),
      address: String(form.get("address") ?? "").trim(),
      city: String(form.get("city") ?? "").trim(),
      phone: String(form.get("phone") ?? "").trim(),
    };
    try {
      const idempotencyKey = await getCheckoutIdempotencyKey({
        ...customer,
        deliveryMethod: delivery,
        items: cart,
      });
      const result = await checkout.mutateAsync({
        ...customer,
        idempotencyKey,
        deliveryMethod: delivery,
        items: cart,
      });
      if (!result.authorizationUrl.startsWith("https://checkout.paystack.com/")) {
        throw new Error("The payment provider returned an untrusted checkout URL.");
      }
      window.location.assign(result.authorizationUrl);
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : "Checkout could not be started. Please try again.";
      if (/expired|already paid|finished/i.test(message)) clearCheckoutIdempotencyKeys();
      setError(message);
    }
  };
  return <main><div className="checkout-steps container-wide"><span className="done">Cart</span><span className="active">Checkout</span><span>Payment confirmation</span></div><section className="checkout-layout container-wide"><div className="checkout-form"><span className="eyebrow">Secure checkout</span><h1>Shipping information</h1>{cancelledCheckout && <p className="payment-provider-note">You returned from Paystack without completing payment. Your pending checkout remains reserved; use the same details to reopen it, or contact support if the payment status is unclear.</p>}<form onSubmit={submitCheckout}><div className="form-grid"><Field name="firstName" label="FIRST NAME" placeholder="John" defaultValue={profile?.firstName ?? ""} required /><Field name="lastName" label="LAST NAME" placeholder="Doe" defaultValue={profile?.lastName ?? ""} required /><Field name="email" label="EMAIL" placeholder="john@example.com" type="email" defaultValue={profile?.email ?? auth.data.email ?? ""} required /><Field name="address" label="ADDRESS" placeholder="Street address" wide defaultValue={profile?.address ?? ""} required /><Field name="city" label="CITY" placeholder="Lagos" defaultValue={profile?.city ?? ""} required /><Field name="phone" label="PHONE" placeholder="+234" defaultValue={profile?.phone ?? ""} required /></div><div className="form-section"><h2>Delivery method</h2><Choice label="Standard Delivery" sub={shipping === 0 ? "Standard delivery · Free estimate" : `Standard delivery · ${money(shipping)} estimate`} checked={delivery === "standard"} onChange={() => setDelivery("standard")} /><Choice label="Express Delivery" sub="Express delivery · ₦7,500 estimate" checked={delivery === "express"} onChange={() => setDelivery("express")} /></div><p className="payment-provider-note"><ShieldCheck size={16} /> Paystack hosts the payment page for eligible merchant accounts. Available methods depend on your account settings; card details are never entered on this site.</p>{error && <p className="portal-error" role="alert">{error}</p>}{missingLine && <p className="portal-error">Your cart contains an item that is no longer available.</p>}<button className="button button--dark button--full" type="submit" disabled={checkout.isPending || missingLine || cart.length > 30}>{checkout.isPending ? "Opening secure checkout…" : "Continue to Secure Payment"}<ArrowRight size={17} /></button></form></div><aside className="summary-card checkout-summary"><h2>Order Estimate</h2>{cart.map((line) => { const product = catalogProducts.find(item => item.id === line.productId); return product ? <div className="mini-line" key={`${line.productId}-${line.size}`}><img src={product.image} alt={product.name} /><div><strong>{product.name}</strong><span>Qty: {line.quantity} · {line.size}</span></div><b>{money(product.price * line.quantity)}</b></div> : null; })}<div className="summary-divider" /><div><span>Subtotal estimate</span><strong>{money(subtotal)}</strong></div><div><span>Delivery estimate</span><strong>{deliveryCharge === 0 ? "Free" : money(deliveryCharge)}</strong></div><div className="summary-total"><span>Estimate</span><strong>{money(checkoutTotal)}</strong></div><small>The server recalculates the final price and stock before creating the order.</small></aside></section></main>;
}

function Field({ name, label, placeholder, type = "text", wide = false, required = false, defaultValue }: { name?: string; label: string; placeholder: string; type?: string; wide?: boolean; required?: boolean; defaultValue?: string }) { return <label className={`form-field ${wide ? "form-field--wide" : ""}`}><span>{label}</span><input name={name} required={required} type={type} placeholder={placeholder} defaultValue={defaultValue} /></label>; }
function Choice({ label, sub, checked, onChange }: { label: string; sub: string; checked: boolean; onChange: () => void }) { return <button type="button" className={`choice-row ${checked ? "selected" : ""}`} onClick={onChange}><span className="choice-radio" /> <span><strong>{label}</strong><small>{sub}</small></span><Truck size={17} /></button>; }

export function OrderConfirmationPage() {
  const paymentReference = new URLSearchParams(window.location.search).get("reference");
  const { clearCart } = useStore();
  const started = useRef(false);
  const cleared = useRef(false);
  const orders = trpc.orders.mine.useQuery(undefined, { enabled: Boolean(paymentReference), retry: false });
  const verify = trpc.orders.verifyMyPayment.useMutation({ onSuccess: () => { void orders.refetch(); } });
  useEffect(() => {
    if (paymentReference && !started.current) {
      started.current = true;
      verify.mutate({ reference: paymentReference });
    }
  }, [paymentReference, verify.mutate]);
  useEffect(() => {
    if (verify.data?.status === "paid" && !cleared.current) {
      cleared.current = true;
      clearCart();
      clearCheckoutIdempotencyKeys();
    }
    if (verify.data?.status === "failed") clearCheckoutIdempotencyKeys();
  }, [verify.data?.status, clearCart]);
  const order = orders.data?.find(item => item.reference === verify.data?.orderReference);
  const itemCount = order?.items.reduce((sum, item) => sum + item.quantity, 0) ?? 0;
  if (!paymentReference) return <main><PageIntro eyebrow="Payment status" title="No Paystack transaction reference was supplied." copy="Open your order history to review existing purchases or return to the storefront." /><div className="empty-state container-wide"><Link className="button button--dark" href="/account">My account <ArrowRight size={17} /></Link></div></main>;
  const status = verify.data?.status;
  const heading = status === "paid" ? "Payment confirmed" : status === "failed" ? "Payment not completed" : "Confirming your payment";
  const message = status === "paid"
    ? "Paystack and the NaijaKoblas order record confirm this payment. Your seller fulfillment status will update in your account."
    : status === "failed"
      ? "Paystack reports this transaction failed or expired. Your cart remains saved so you can review availability and try again."
      : "A return from Paystack is not by itself proof of payment. We are checking the transaction status against your order.";
  return <main><section className="confirmation-hero"><div className="confirmation-check">{status === "paid" ? <Check size={32} /> : <Clock3 size={28} />}</div><span className="eyebrow">Paystack Checkout</span><h1>{heading}</h1><p>{message}</p>{verify.data?.orderReference && <span className="order-number">Order reference: <strong>{verify.data.orderReference}</strong></span>}</section>
    {order && status === "paid" && <section className="confirmation-layout container-wide"><div className="confirmation-card"><div className="confirmation-card-heading"><h2>Order Items</h2><span>{itemCount} {itemCount === 1 ? "item" : "items"}</span></div>{order.items.map(line => <div className="confirmed-line" key={line.id}><div><strong>{line.nameSnapshot}</strong><span>Qty: {line.quantity} · Size: {line.size}</span></div><b>{money(line.lineTotalKobo / 100)}</b></div>)}<div className="confirmation-card-heading"><h2>Shipping Information</h2></div><div className="shipping-address"><strong>{order.firstName} {order.lastName}</strong><span>{order.address}</span><span>{order.city}, Nigeria</span><span>{order.deliveryMethod === "express" ? "Express delivery" : "Standard delivery"}</span></div></div><aside className="summary-card confirmation-total"><h2>Order Total</h2><div><span>Subtotal</span><strong>{money(order.subtotalKobo / 100)}</strong></div><div><span>Shipping</span><strong>{order.shippingKobo === 0 ? "Free" : money(order.shippingKobo / 100)}</strong></div><div className="summary-total"><span>Total</span><strong>{money(order.totalKobo / 100)}</strong></div><p>Status: {order.status.replaceAll("_", " ")}</p></aside></section>}
    {verify.error && <p className="portal-error container-wide" role="alert">{verify.error.message} You can retry this check from your account order history.</p>}
    {status === "paid" && !order && <p className="catalog-status container-wide">Payment is confirmed. Loading your private order details…</p>}
    <section className="next-steps section section--tint"><div className="container-wide"><SectionHeading eyebrow="Next steps" title={status === "failed" ? "Try another checkout." : "Your orders stay in your account."} /><p className="confirmation-preview-note">Orders and fulfillment updates are available only after secure sign-in. Payment is confirmed server-side; returning to this page does not create a second charge.</p><div className="confirmation-actions"><Link className="button button--dark" href={status === "failed" ? "/checkout" : "/account"}>{status === "failed" ? "Review Cart" : "View My Account"} <ArrowRight size={17} /></Link><Link className="button button--outline" href="/products">Continue Shopping</Link></div></div></section>
  </main>;
}
function TimelineItem({ icon, title, copy }: { icon: React.ReactNode; title: string; copy: string }) { return <div className="timeline-item"><div className="timeline-icon">{icon}</div><strong>{title}</strong><p>{copy}</p></div>; }

export function AboutPage() { const values = [["Authenticity", "Every product is verified and sourced directly from the maker."], ["Fair Trade", "Artisans receive fair compensation for their work, always."], ["Quality First", "We maintain strict quality standards to ensure customers buy once and buy well."], ["Community", "Building connections between makers and customers across Nigeria."], ["Growth", "Empowering artisans with training, resources, and a wider audience."], ["Cultural Pride", "Celebrating Nigerian craftsmanship and sharing it with the world."]]; return <main><PageIntro eyebrow="Our Story" title="Why NaijaKoblas" copy="We're building a marketplace that empowers Nigerian artisans and gives great craft the platform it deserves." /><section className="mission-section container-wide"><div className="mission-number">01</div><div><span className="eyebrow">Our Mission</span><h2>Preserving Heritage<br /><em>Through Commerce</em></h2><p>For generations, Nigerian leather artisans have made objects of beauty and utility. But great craft is often hard to find, and makers rarely get the reach they deserve.</p><p>NaijaKoblas bridges this gap, connecting skilled craftsmen with customers who value the hand, the story and the materials behind what they wear.</p><div className="hero-actions"><Link className="button button--dark" href="/products">Shop Collection <ArrowRight size={17} /></Link><Link className="button button--outline" href="/vendor">Become a Vendor <ArrowRight size={17} /></Link></div></div><div className="mission-image"><img src={heroImage} alt="Artisan leather goods" /></div></section><section className="section section--tint"><div className="container-wide"><SectionHeading eyebrow="What We Stand For" title="Our Core Values" /><div className="values-grid">{values.map(([title, copy], index) => <div className="value-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></div>)}</div></div></section><NewsletterBand compact /></main>; }

export function ContactPage() { const [sent, setSent] = useState(false); return <main><PageIntro eyebrow="Say hello" title="Contact Us" copy="We'd love to hear from you. Send us a message and we'll get back to you within 24 hours." /><section className="contact-layout container-wide"><div className="contact-form-card"><h2>Send us a Message</h2><form onSubmit={(event) => { event.preventDefault(); setSent(true); }}><div className="form-grid"><Field label="FIRST NAME" placeholder="John" required /><Field label="LAST NAME" placeholder="Doe" required /><Field label="EMAIL" placeholder="john@example.com" type="email" required /><Field label="SUBJECT" placeholder="How can we help?" wide required /><label className="form-field form-field--wide"><span>MESSAGE</span><textarea required placeholder="Tell us more..." rows={5} /></label></div><button className="button button--dark" type="submit">{sent ? "Message Sent" : "Send Message"}<ArrowRight size={17} /></button></form>{sent && <p className="form-success"><Check size={16} /> Thanks — we'll be in touch soon.</p>}</div><div className="contact-details"><span className="eyebrow">Find us here</span><ContactDetail href="mailto:hello@naijakoblas.com" icon={<Mail />} title="Email" copy="hello@naijakoblas.com" sub="We'll respond within 24 hours" /><ContactDetail href="tel:+2348000000000" icon={<Clock3 />} title="Phone" copy="+234 800 000 0000" sub="Mon-Fri 9am-6pm WAT" /><ContactDetail icon={<MapPin />} title="Office" copy="Victoria Island, Lagos" sub="Nigeria" /><ContactDetail href="https://wa.me/2348000000000" icon={<Sparkles />} title="WhatsApp" copy="Quick support available" sub="Chat with our team" /></div></section><section className="faq-section section section--tint" id="faq"><div className="container-wide"><SectionHeading eyebrow="Need to know" title="Frequently Asked Questions" /><div className="faq-grid">{["How do I track my order?", "What's your return policy?", "How are artisans verified?", "Do you ship internationally?"].map((question) => <details key={question}><summary>{question}<Plus size={18} /></summary><p>We’ll send clear updates by email and keep our support team close if you need a hand.</p></details>)}</div></div></section></main>; }
function ContactDetail({ href, icon, title, copy, sub }: { href?: string; icon: React.ReactNode; title: string; copy: string; sub: string }) { const content = <><div className="contact-icon">{icon}</div><div><span>{title}</span><strong>{copy}</strong><small>{sub}</small></div></>; return href ? <a className="contact-detail" href={href} target={href.startsWith("http") ? "_blank" : undefined} rel={href.startsWith("http") ? "noreferrer" : undefined}>{content}</a> : <div className="contact-detail">{content}</div>; }

export function VendorPage() {
  const benefits = [
    ["Seller-owned listings", "Create draft products with your description, image, sizes and price."],
    ["Inventory control", "Manage listing stock; stock is protected while pending checkouts reserve units."],
    ["Paid-order visibility", "See your own order lines only after customer payment is verified."],
    ["Per-item fulfillment", "Move each line through processing, shipped and delivered states."],
    ["Hosted buyer checkout", "Customers use Paystack-hosted Checkout when the merchant account and channels are configured."],
    ["Seller payouts", "Payout terms and automated settlement are not active; they depend on a confirmed supported route."],
  ];
  const steps = [["Apply", "Submit your business and contact details"], ["Review", "The partnerships team reviews your application"], ["List", "Create draft listings with details and stock"], ["Fulfil", "Manage your seller-owned paid order lines"]];
  return <main>
    <section className="vendor-hero container-wide"><div><Pill tone="lime">For Nigerian Artisans</Pill><h1>Sell Your Craft.<br /><em>Build Your Presence.</em></h1><p>Apply to join NaijaKoblas, create seller-owned product listings and manage stock and paid-order fulfillment from one workspace.</p><div className="hero-actions"><a className="button button--dark" href="#apply">Apply for Seller Access <ArrowRight size={17} /></a><a className="button button--outline" href="#process">How It Works <ArrowDownRight size={17} /></a></div></div><div className="vendor-illustration"><div className="vendor-stat"><strong>Seller workspace</strong><span>Listings · Stock · Fulfillment</span></div><img src={products[2].image} alt="Leather artisan product" /></div></section>
    <section className="vendor-stats"><div className="container-wide vendor-stats-grid"><div><strong>01</strong><span>Apply for review</span></div><div><strong>02</strong><span>Publish eligible listings</span></div><div><strong>03</strong><span>Manage paid order lines</span></div></div></section>
    <section className="section container-wide" id="process"><SectionHeading eyebrow="Seller tools" title="A clear marketplace workflow" /><div className="benefits-grid">{benefits.map(([title, copy], index) => <div className="benefit-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></div>)}</div></section>
    <section className="section section--dark" id="requirements"><div className="container-wide"><SectionHeading eyebrow="Application steps" title="From application to fulfillment" /><div className="process-grid">{steps.map(([title, copy], index) => <div className="process-item" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></div>)}</div></div></section>
    <VendorRequirements /><VendorApplication /><NewsletterBand />
  </main>;
}

function VendorRequirements() {
  const requirements = [
    ["Seller application", "Provide business, craft and contact details for review"],
    ["Approved access", "Seller privileges are granted only after staff approval"],
    ["Product listing", "Use accurate descriptions, HTTPS image URLs, prices and sizes"],
    ["Store activation", "A store must be active before a product can be published"],
    ["Payment eligibility", "Confirm the Paystack merchant account and enabled Nigerian payment channels"],
    ["Settlement policy", "Payout details are not collected until a supported seller-payout route is established"],
  ];
  return <section className="section vendor-requirements"><div className="container-wide"><SectionHeading eyebrow="Before you apply" title="Marketplace onboarding" /><div className="benefits-grid">{requirements.map(([title, copy], index) => <div className="benefit-card" key={title}><span>0{index + 1}</span><h3>{title}</h3><p>{copy}</p></div>)}</div></div></section>;
}

function VendorApplication() {
  const auth = trpc.auth.me.useQuery(undefined, { retry: false });
  const account = trpc.account.me.useQuery(undefined, { enabled: Boolean(auth.data), retry: false });
  const submit = trpc.account.submitSellerApplication.useMutation({ onSuccess: () => account.refetch() });

  if (auth.isLoading || (auth.data && account.isLoading)) {
    return <section className="vendor-application section" id="apply"><div className="container-wide vendor-application-grid"><div><span className="eyebrow">Seller onboarding</span><h2>Preparing your<br /><em>application.</em></h2></div></div></section>;
  }

  if (!auth.data) {
    return <section className="vendor-application section" id="apply"><div className="container-wide vendor-application-grid"><div><span className="eyebrow">Ready to join us?</span><h2>Tell us about<br /><em>your craft.</em></h2><p>Sign in securely first, then your application is linked to a real NaijaKoblas account and can be reviewed by the partnerships team.</p></div><div className="vendor-auth-cta"><ShieldCheck size={24} /><strong>Secure seller application</strong><p>One account works for shopping, selling and staff access. Your permissions are checked on the server.</p><button className="button button--dark" type="button" onClick={() => startLogin()}>Sign in to apply <ArrowRight size={17} /></button></div></div></section>;
  }

  if (!account.data) {
    return <section className="vendor-application section" id="apply"><div className="container-wide"><p className="portal-error">We could not confirm your account. Please refresh or sign in again.</p></div></section>;
  }

  const existing = account.data.sellerApplication;
  if (existing) {
    const copy = existing.status === "pending" ? "Your application is in review. We will contact you with the next step." : existing.status === "approved" ? "Your seller account is approved and your protected seller workspace is ready." : existing.status === "rejected" ? "Your application was not approved yet. Please contact the partnerships team for next steps." : "Your seller access is currently paused. Please contact the partnerships team.";
    return <section className="vendor-application section" id="apply"><div className="container-wide vendor-application-grid"><div><span className="eyebrow">Seller application</span><h2>Your application<br /><em>is {existing.status}.</em></h2><p>{copy}</p></div><div className="vendor-auth-cta"><BadgeCheck size={24} /><strong className={`status-label status-label--${existing.status}`}>{existing.status}</strong><p>{existing.reviewNote ?? "Seller review decisions are stored against your authenticated account."}</p>{existing.status === "approved" && <Link href="/seller" className="button button--dark">Open seller workspace <ArrowRight size={17} /></Link>}<Link href="/account" className="text-link">View your account <ArrowRight size={15} /></Link></div></div></section>;
  }

  if (account.data.user.role === "staff" || account.data.user.role === "admin") {
    return <section className="vendor-application section" id="apply"><div className="container-wide vendor-application-grid"><div><span className="eyebrow">Seller application</span><h2>Your trusted role<br /><em>is already active.</em></h2><p>Staff and administrators review marketplace access and cannot submit a seller application from this account.</p></div><div className="vendor-auth-cta"><ShieldCheck size={24} /><strong>{account.data.user.role === "admin" ? "Administrator workspace" : "Staff workspace"}</strong><Link href={account.data.user.role === "admin" ? "/admin" : "/staff"} className="button button--dark">Open portal <ArrowRight size={17} /></Link></div></div></section>;
  }

  return <section className="vendor-application section" id="apply"><div className="container-wide vendor-application-grid"><div><span className="eyebrow">Ready to join us?</span><h2>Tell us about<br /><em>your craft.</em></h2><p>Apply as a vendor and our partnerships team will review your details within two business days.</p></div><form onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); submit.mutate({ legalName: String(form.get("legalName")), email: String(form.get("email")), businessName: String(form.get("businessName")), craftSummary: String(form.get("craftSummary")), phone: String(form.get("phone")), city: String(form.get("city")) }); }}><div className="form-grid"><Field label="FULL NAME" name="legalName" placeholder="Your name" defaultValue={account.data.user.name ?? ""} required /><Field label="EMAIL" name="email" type="email" placeholder="you@example.com" defaultValue={account.data.user.email ?? ""} required /><Field label="BUSINESS / WORKSHOP" name="businessName" placeholder="Your business name" wide required /><Field label="WHAT DO YOU MAKE?" name="craftSummary" placeholder="Leather shoes, bags, belts and accessories…" wide required /><Field label="PHONE" name="phone" placeholder="+234" required /><Field label="CITY" name="city" placeholder="Lagos" required /></div><button className="button button--dark" type="submit" disabled={submit.isPending}>{submit.isPending ? "Submitting…" : "Apply as Vendor"}<ArrowRight size={17} /></button>{submit.error && <p className="portal-error">{submit.error.message}</p>}</form></div></section>;
}

export function InfoPage() { const [, params] = useRoute("/info/:topic"); const pages: Record<string, { eyebrow: string; title: string; intro: string; sections: [string, string][] }> = { help: { eyebrow: "Support", title: "Help Center", intro: "Practical answers for shopping with NaijaKoblas.", sections: [["Orders", "Use your order confirmation email to review your purchase and follow delivery updates."], ["Product care", "Each product page lists material details and care guidance so your leather goods grow more beautiful with time."], ["Need a hand?", "Our team is available Monday to Friday, 9am–6pm WAT at hello@naijakoblas.com."]] }, shipping: { eyebrow: "Support", title: "Shipping Information", intro: "We deliver authentic craft across Nigeria with care.", sections: [["Standard Delivery", "Standard delivery arrives in 5–7 business days and is free for orders over ₦50,000."], ["Express Delivery", "Choose Express Delivery at checkout for delivery in 2–3 business days for ₦7,500."], ["Tracking", "Once your order ships, we’ll send a confirmation email with delivery information."]] }, returns: { eyebrow: "Support", title: "Returns", intro: "We want you to feel confident in every piece you choose.", sections: [["14-day returns", "Eligible items may be returned within 14 days of delivery in unused, original condition."], ["Start a return", "Contact support with your order number and our team will guide you through the next step."], ["Your refund", "Approved refunds are issued to your original payment method after the return is received and reviewed."]] }, privacy: { eyebrow: "Legal", title: "Privacy Policy", intro: "Your data is treated with the same care as the craft we champion.", sections: [["What we collect", "We use the contact and delivery details you provide to fulfil orders and support your experience."], ["How we use it", "We never sell personal information. We use it only to operate NaijaKoblas and communicate about your order or opted-in updates."], ["Your choices", "You can contact us to update your details or unsubscribe from marketing messages at any time."]] }, terms: { eyebrow: "Legal", title: "Terms of Service", intro: "A clear agreement for a considered marketplace.", sections: [["Marketplace role", "NaijaKoblas connects shoppers with verified Nigerian artisans and their authentic work."], ["Orders", "Placing an order confirms your selected product, delivery details and checkout total."], ["Support", "For questions about an order or these terms, contact hello@naijakoblas.com."]] } }; const page = pages[params?.topic ?? "help"] ?? pages.help; return <main><PageIntro eyebrow={page.eyebrow} title={page.title} copy={page.intro} /><section className="info-page container-wide">{page.sections.map(([heading, copy], index) => <article key={heading}><span>0{index + 1}</span><div><h2>{heading}</h2><p>{copy}</p></div></article>)}<Link href="/contact" className="button button--dark">Contact Support <ArrowRight size={17} /></Link></section></main>; }

export function WaitlistPage() { const [email, setEmail] = useState(""); const [sent, setSent] = useState(false); return <main className="waitlist-page"><section className="waitlist-hero"><div className="waitlist-nav container-wide"><Link href="/" className="brand-mark"><span>NK</span><strong>NaijaKoblas</strong></Link><span className="eyebrow">Coming Soon</span></div><div className="waitlist-copy container-wide"><span className="eyebrow">Built from</span><h1>culture.</h1><span className="eyebrow">Worn with</span><h1><em>purpose.</em></h1><p>NaijaKoblas is creating a platform that brings Nigerian craftsmanship closer to the world.</p><small>Our full platform is currently in development</small><form onSubmit={(event) => { event.preventDefault(); if (email) setSent(true); }}><input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Enter your email address" /><button className="button button--lime">{sent ? "You're on the list" : "Join Early Access"}<ArrowRight size={17} /></button></form><span className="waitlist-note">No spam. No noise. Just first access when we go live.</span></div><div className="waitlist-scroll"><span>Scroll</span><ArrowDownRight size={18} /></div></section><section className="waitlist-features container-wide"><WaitFeature title="Handcrafted Sneakers" copy="Authentic Nigerian-made" image={products[0].image} /><WaitFeature title="Premium Belts" copy="Every product verified" image={products[2].image} /><WaitFeature title="Artisan Boots" copy="Made with heritage" image={products[8].image} /></section><section className="waitlist-story section container-wide"><span className="eyebrow">What to expect</span><h2>A marketplace unlike<br /><em>anything before it.</em></h2><div className="waitlist-story-grid"><p>From handmade leather shoes to premium artisan products, we're building a space where quality craftsmanship gets the attention it deserves.</p><div><strong>Join those already on the list</strong><span>Free to join. First access when we launch.</span><Link href="/products" className="text-link">Explore the collection <ArrowRight size={16} /></Link></div></div></section><section className="waitlist-social section section--dark"><div className="container-wide"><span className="eyebrow eyebrow--light">Stay connected</span><h2>Follow the journey<br /><em>as we build.</em></h2><p>Get behind-the-scenes updates, artisan stories, and more.</p><div className="social-links"><a href="https://instagram.com"><Instagram size={18} /> Instagram</a><a href="https://linkedin.com"><span>in</span> LinkedIn</a><a href="https://wa.me"><span>WA</span> WhatsApp</a></div></div></section></main>; }
function WaitFeature({ title, copy, image }: { title: string; copy: string; image: string }) { return <div className="wait-feature"><img src={image} alt="" /><div><span>{copy}</span><h3>{title}</h3></div></div>; }
