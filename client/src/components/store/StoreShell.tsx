import { Link, useLocation } from "wouter";
import { ArrowRight, Box, ChevronDown, Heart, House, Instagram, Linkedin, Menu, Search, ShoppingBag, Sparkles, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStore, type Product, money } from "@/store";
import { useTheme } from "@/contexts/ThemeContext";
import { useAuth } from "@/_core/hooks/useAuth";
import { NotificationBell } from "./NotificationBell";

export function BrandMark({ light = false }: { light?: boolean }) {
  const { theme } = useTheme();
  const logo = light || theme === "dark" ? "/naija-koblas-logo-white.png" : "/naija-koblas-logo-light.png";
  return <Link href="/" className={`brand-mark ${light ? "brand-mark--light" : ""}`} aria-label="NaijaKoblas home"><img src={logo} alt="Naija Koblas" /></Link>;
}

export function Navbar() {
  const [location, navigate] = useLocation();
  const { cartCount } = useStore();
  const { theme, toggleTheme } = useTheme();
  const auth = useAuth();
  const [open, setOpen] = useState(false);
  const navRef = useRef<HTMLElement | null>(null);
  const menuButtonRef = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    document.body.classList.toggle("menu-open", open);
    if (!open) return () => document.body.classList.remove("menu-open");

    const focusFrame = window.requestAnimationFrame(() => navRef.current?.querySelector<HTMLAnchorElement>("a")?.focus());
    const handleMenuKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Tab") {
        const navigation = navRef.current;
        const menuLinks = navigation ? Array.from(navigation.querySelectorAll<HTMLAnchorElement>('a[href]')) : [];
        if (menuLinks.length === 0) return;
        const first = menuLinks[0]!;
        const last = menuLinks[menuLinks.length - 1]!;
        const focusIsOutside = !navigation?.contains(document.activeElement);
        if (event.shiftKey && (focusIsOutside || document.activeElement === first)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (focusIsOutside || document.activeElement === last)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      menuButtonRef.current?.focus();
    };
    const closeOnOutsidePointer = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (navRef.current?.contains(target) || menuButtonRef.current?.contains(target)) return;
      const element = target instanceof Element ? target : target.parentElement;
      const clickedFocusable = element?.closest('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])');
      setOpen(false);
      if (!clickedFocusable) {
        window.requestAnimationFrame(() => {
          const menuButton = menuButtonRef.current;
          if (menuButton && menuButton.getClientRects().length > 0) menuButton.focus();
          else navRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
        });
      }
    };
    document.addEventListener("keydown", handleMenuKeyboard);
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      document.removeEventListener("keydown", handleMenuKeyboard);
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.body.classList.remove("menu-open");
    };
  }, [open]);
  const links: Array<[string, string]> = [
    ["Home", "/"],
    ["Products", "/products"],
    ["Why Koblas", "/about"],
    ["Contact Us", "/contact"],
    ["Become a Vendor", "/vendor"],
    ["Get Started", "/waitlist"],
  ];
  if (auth.user?.role === "seller") links.push(["Seller Workspace", "/seller"]);
  if (auth.user?.role === "staff") links.push(["Staff Portal", "/staff"]);
  links.push(auth.isAuthenticated ? ["Account", "/account"] : ["Sign In", "/login"]);
  return <header className="site-header">
    <div className="nav-inner container-wide">
      <BrandMark />
      <nav id="primary-navigation" ref={navRef} className={`desktop-nav ${open ? "desktop-nav--open" : ""}`} aria-label="Main navigation">
        {links.map(([label, href]) => <Link key={href} href={href} className={location === href ? "active" : ""} onClick={() => { if (open) menuButtonRef.current?.focus(); setOpen(false); }}>{label}</Link>)}
      </nav>
      <div className="nav-actions">
        <button className="icon-button nav-search" aria-label="Search" onClick={() => navigate("/products")}><Search size={18} /></button>
        <button className="icon-button nav-theme" aria-label="Toggle theme" aria-pressed={theme === "dark"} onClick={() => toggleTheme?.()}><Sparkles size={17} /></button>
        <NotificationBell />
        <Link href="/account" className="account-link">Account</Link>
        <Link href="/account" className="mobile-account-button" aria-label="Account"><UserRound size={18} /></Link>
        <Link href="/cart" className="cart-link" aria-label={`Cart with ${cartCount} items`}><ShoppingBag size={19} /><span>{cartCount}</span></Link>
        <button ref={menuButtonRef} type="button" className="icon-button mobile-menu-button" aria-label={open ? "Close menu" : "Open menu"} aria-expanded={open} aria-controls="primary-navigation" onClick={() => setOpen((value) => !value)}>{open ? <X size={22} /> : <Menu size={22} />}</button>
      </div>
    </div>
  </header>;
}

export function Footer() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  return <footer className="site-footer">
    <div className="container-wide footer-newsletter">
      <div className="footer-newsletter-copy"><span className="eyebrow eyebrow--light">Stay connected</span><h2>Stay close to the craft.</h2><p>New collections, artisan stories, and early access — thoughtfully delivered.</p></div>
      <form className="newsletter-form" onSubmit={(event) => { event.preventDefault(); if (email) setSubmitted(true); }}>
        <input type="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="Your email address" aria-label="Your email address" />
        <button className="button button--lime" type="submit">{submitted ? "Subscribed" : "Subscribe"}<ArrowRight size={17} /></button>
      </form>
    </div>
    <div className="container-wide footer-main">
      <div className="footer-about"><BrandMark light /><p>Connecting craftsmanship, culture and commerce through premium African leather goods.</p><span className="footer-location">Lagos, Nigeria · Made with purpose.</span><div className="social-links"><a href="https://instagram.com" aria-label="Instagram"><Instagram size={17} /></a><a href="https://linkedin.com" aria-label="LinkedIn"><Linkedin size={17} /></a><a href="https://wa.me" aria-label="WhatsApp">WA</a></div></div>
      <div className="footer-column"><h3>Products</h3><Link href="/products?category=Shoes">Shoes</Link><Link href="/products?category=Bags">Bags</Link><Link href="/products?category=Belts">Belts</Link><Link href="/products?category=Accessories">Accessories</Link></div>
      <div className="footer-column"><h3>Company</h3><Link href="/about">About Us</Link><Link href="/vendor">Become a Vendor</Link><Link href="/contact">Contact</Link></div>
      <div className="footer-column"><h3>Support</h3><Link href="/info/help">Help Center</Link><Link href="/info/shipping">Shipping Info</Link><Link href="/info/returns">Returns</Link></div>
    </div>
    <div className="container-wide footer-bottom"><span>© 2026 NaijaKoblas. All rights reserved.</span><span><Link href="/info/privacy">Privacy Policy</Link><Link href="/info/terms">Terms of Service</Link></span></div>
  </footer>;
}

export function StoreShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { cartCount } = useStore();
  const links = [
    ["Home", "/", <House size={17} />],
    ["Shop", "/products", <Box size={17} />],
    ["Cart", "/cart", <ShoppingBag size={17} />],
    ["Account", "/account", <UserRound size={17} />],
  ];
  return <div className="store-app"><Navbar />{children}<nav className="mobile-bottom-nav" aria-label="Mobile navigation">{links.map(([label, href, icon]) => <Link key={href as string} href={href as string} className={location === href || (href === "/products" && location.startsWith("/products")) ? "active" : ""}>{icon}{label === "Cart" && cartCount > 0 && <b>{cartCount}</b>}<span>{label}</span></Link>)}</nav><Footer /></div>;
}

export function PageIntro({ eyebrow, title, copy }: { eyebrow: string; title: string; copy?: string }) {
  return <section className="page-intro container-wide"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{copy && <p>{copy}</p>}</section>;
}

export function SectionHeading({ eyebrow, title, copy, action }: { eyebrow?: string; title: string; copy?: string; action?: ReactNode }) {
  return <div className="section-heading"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{copy && <p>{copy}</p>}</div>{action}</div>;
}

export function Pill({ children, tone = "dark" }: { children: ReactNode; tone?: "dark" | "light" | "lime" }) {
  return <span className={`pill pill--${tone}`}>{children}</span>;
}

export function ProductCard({ product }: { product: Product }) {
  const { addToCart, wishlist, toggleWishlist } = useStore();
  const saved = wishlist.includes(product.id);
  return <article className="product-card">
    <div className="product-image-wrap"><Link href={`/products/${product.id}`} className="product-image-link"><img src={product.image} alt={product.name} /></Link><button className={`wishlist-button ${saved ? "saved" : ""}`} onClick={() => toggleWishlist(product.id)} aria-label={saved ? "Remove from wishlist" : "Add to wishlist"}><Heart size={17} fill={saved ? "currentColor" : "none"} /></button></div>
    <div className="product-card-meta"><div><Link href={`/products/${product.id}`} className="product-name">{product.name}</Link><span className="product-maker">by {product.maker} <span className="verified"><span>✓</span> Verified</span></span></div><strong>{money(product.price)}</strong></div>
    <div className="product-card-bottom"><button className="text-button" onClick={() => addToCart(product.id)}>Add to Cart</button></div>
  </article>;
}

export function TrustStrip() {
  const items = [["Active Sellers", "Published listings belong to active seller accounts"], ["Hosted Checkout", "Payment details are entered only on Paystack’s hosted page"], ["Order Visibility", "Customers can view order and fulfillment status in their account"], ["Seller Workspace", "Vendors manage their listings, stock and paid order lines"]];
  return <section className="trust-strip"><div className="container-wide trust-grid">{items.map(([title, copy], index) => <div className="trust-item" key={title}><span className="trust-number">0{index + 1}</span><div><h3>{title}</h3><p>{copy}</p></div></div>)}</div></section>;
}

export function Breadcrumb({ items }: { items: string[] }) {
  return <div className="breadcrumb container-wide">{items.map((item, index) => <span key={item} className={index === items.length - 1 ? "current" : ""}>{item}{index < items.length - 1 && <ChevronDown size={13} />}</span>)}</div>;
}
