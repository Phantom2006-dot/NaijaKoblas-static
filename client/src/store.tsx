import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { trpc } from "@/lib/trpc";

export type Product = {
  id: string;
  name: string;
  category: string;
  maker: string;
  price: number;
  image: string;
  images?: string[];
  badge?: "New" | "Popular" | "Limited";
  description: string;
  rating?: number;
  reviews?: number;
  sizes: string[];
  experience?: string;
  color?: "Brown" | "Tan" | "Black" | "Olive" | "Rust" | "Sand";
  inventoryCount?: number;
}

export type CartLine = { productId: string; quantity: number; size: string };

const leather = {
  sneakers: "/naijakoblas-sneakers.jpg",
  detail: "/naijakoblas-sneakers-detail.jpg",
  tote: "/naijakoblas-tote.jpg",
  belt: "/naijakoblas-belt.jpg",
  briefcase: "/naijakoblas-briefcase.jpg",
  shoulder: "/naijakoblas-shoulder-satchel.jpg",
  doubleMonk: "/naijakoblas-double-monk.jpg",
  wallet: "/naijakoblas-wallet.jpg",
  messenger: "/naijakoblas-messenger.jpg",
  boots: "/naijakoblas-boots.jpg",
};

export const products: Product[] = [
  {
    id: "signature-sneakers",
    name: "NK Signature Leather Sneakers",
    category: "Shoes",
    maker: "Seun Okafor",
    price: 58500,
    image: leather.sneakers,
    color: "Brown",
    badge: "New",
    description: "Premium brown leather sneakers featuring the iconic NK gold emblem. Hand-stitched with precision using traditional Nigerian craftsmanship techniques. White sole and comfortable leather lining.",
    rating: 4.8,
    reviews: 124,
    sizes: ["XS", "S", "M", "L", "XL"],
    experience: "18+ years experience",
  },
  {
    id: "lagos-tote",
    name: "Lagos Heritage Tote Bag",
    category: "Bags",
    maker: "Adaeze Craft Co",
    price: 62000,
    image: leather.tote,
    color: "Tan",
    description: "A considered leather tote with room for the essentials and a story stitched into every panel.",
    rating: 4.9,
    reviews: 86,
    sizes: ["One Size"],
    experience: "12 years experience",
  },
  {
    id: "executive-leather-belt",
    name: "NK Executive Leather Belt",
    category: "Belts",
    maker: "Kano Leather Guild",
    price: 28000,
    image: leather.belt,
    color: "Brown",
    badge: "Popular",
    description: "A refined full-grain leather belt finished with the NK emblem and a considered metal buckle.",
    rating: 4.7,
    reviews: 65,
    sizes: ["S", "M", "L", "XL"],
    experience: "22 years experience",
  },
  {
    id: "shoulder-satchel",
    name: "Shoulder Satchel — Tan",
    category: "Bags",
    maker: "Benin Artisan Coop",
    price: 54500,
    image: leather.shoulder,
    color: "Tan",
    description: "A warm tan shoulder satchel with an easy strap and a soft structured silhouette.",
    rating: 4.8,
    reviews: 51,
    sizes: ["One Size"],
    experience: "15 years experience",
  },
  {
    id: "executive-briefcase",
    name: "Executive Briefcase",
    category: "Bags",
    maker: "Seun Okafor",
    price: 185000,
    image: leather.briefcase,
    color: "Black",
    badge: "Limited",
    description: "Full-grain cowhide, hand-stitched with waxed thread and finished to travel with you for years.",
    rating: 4.9,
    reviews: 38,
    sizes: ["One Size"],
    experience: "18+ years experience",
  },
  {
    id: "double-monk-shoes",
    name: "NK Double Monk Strap Shoes",
    category: "Shoes",
    maker: "Lagos Leather Works",
    price: 72000,
    image: leather.doubleMonk,
    color: "Black",
    description: "Polished double monk strap shoes with an elegant last and a hand-finished leather upper.",
    rating: 4.7,
    reviews: 44,
    sizes: ["S", "M", "L", "XL"],
    experience: "16 years experience",
  },
  {
    id: "leather-wallet",
    name: "Leather Wallet",
    category: "Accessories",
    maker: "Ibadan Crafts",
    price: 12500,
    image: leather.wallet,
    color: "Brown",
    badge: "Popular",
    description: "A compact leather wallet with generous card space and a soft, broken-in feel.",
    rating: 4.6,
    reviews: 72,
    sizes: ["Standard"],
    experience: "10 years experience",
  },
  {
    id: "messenger-bag",
    name: "Messenger Bag",
    category: "Bags",
    maker: "Adaeze Craft Co",
    price: 71000,
    image: leather.messenger,
    color: "Brown",
    description: "A practical messenger bag with a durable strap and room for the day ahead.",
    rating: 4.8,
    reviews: 33,
    sizes: ["One Size"],
    experience: "12 years experience",
  },
  {
    id: "combat-leather-boots",
    name: "NK Combat Leather Boots",
    category: "Shoes",
    maker: "Seun Okafor",
    price: 95000,
    image: leather.boots,
    color: "Black",
    badge: "New",
    description: "Durable black leather boots with a grounded tread and an unmistakable NK silhouette.",
    rating: 4.8,
    reviews: 29,
    sizes: ["S", "M", "L", "XL"],
    experience: "18+ years experience",
  },
];

const defaultCart: CartLine[] = [];

type StoreContextValue = {
  cart: CartLine[];
  wishlist: string[];
  catalogProducts: Product[];
  catalogLoading: boolean;
  catalogError: string | null;
  cartCount: number;
  subtotal: number;
  shipping: number;
  total: number;
  addToCart: (productId: string, size?: string) => void;
  updateQuantity: (productId: string, size: string, quantity: number) => void;
  removeFromCart: (productId: string, size: string) => void;
  clearCart: () => void;
  toggleWishlist: (productId: string) => void;
};

const StoreContext = createContext<StoreContextValue | null>(null);

export function StoreProvider({ children }: { children: ReactNode }) {
  const catalogQuery = trpc.catalog.list.useQuery(undefined, { retry: false, refetchOnWindowFocus: true });
  const catalogProducts = useMemo<Product[]>(() => (catalogQuery.data ?? []).map(product => {
    const images = [...new Set([product.imageUrl, ...(product.images ?? [])].filter((image): image is string => Boolean(image)))];
    return {
      id: product.id,
      name: product.name,
      category: product.category,
      maker: product.maker,
      price: product.priceKobo / 100,
      image: images[0] ?? "/naijakoblas-hero.jpg",
      images,
      description: product.description,
      sizes: product.sizes,
      experience: product.city ? `${product.city}, Nigeria` : "Nigeria",
      color: "Brown",
      inventoryCount: product.inventoryCount,
    };
  }), [catalogQuery.data]);
  const [cart, setCart] = useState<CartLine[]>(() => {
    try {
      const saved = localStorage.getItem("koblas-cart");
      return saved ? JSON.parse(saved) : defaultCart;
    } catch {
      return defaultCart;
    }
  });
  const [wishlist, setWishlist] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("koblas-wishlist") ?? "[]"); } catch { return []; }
  });
  useEffect(() => localStorage.setItem("koblas-cart", JSON.stringify(cart)), [cart]);
  useEffect(() => localStorage.setItem("koblas-wishlist", JSON.stringify(wishlist)), [wishlist]);
  useEffect(() => {
    const refresh = () => { void catalogQuery.refetch(); };
    window.addEventListener("visibilitychange", refresh);
    window.addEventListener("focus", refresh);
    return () => {
      window.removeEventListener("visibilitychange", refresh);
      window.removeEventListener("focus", refresh);
    };
  }, [catalogQuery.refetch]);

  const cartCount = cart.reduce((sum, line) => sum + line.quantity, 0);
  const subtotal = cart.reduce((sum, line) => sum + (catalogProducts.find((item) => item.id === line.productId)?.price ?? 0) * line.quantity, 0);
  const shipping = subtotal === 0 || subtotal >= 50000 ? 0 : 2500;
  const total = subtotal + shipping;

  const value = useMemo<StoreContextValue>(() => ({
    cart, wishlist, catalogProducts, catalogLoading: catalogQuery.isLoading,
    catalogError: catalogQuery.error?.message ?? null, cartCount, subtotal, shipping, total,
    addToCart: (productId, size) => setCart((current) => {
      const product = catalogProducts.find((item) => item.id === productId);
      if (!product || (product.inventoryCount ?? 0) < 1) return current;
      const chosenSize = size ?? product?.sizes[0] ?? "Standard";
      const found = current.find((line) => line.productId === productId && line.size === chosenSize);
      if (found) return current.map((line) => line === found ? { ...line, quantity: line.quantity + 1 } : line);
      return [...current, { productId, quantity: 1, size: chosenSize }];
    }),
    updateQuantity: (productId, size, quantity) => setCart((current) => current.map((line) => line.productId === productId && line.size === size ? { ...line, quantity: Math.max(1, quantity) } : line)),
    removeFromCart: (productId, size) => setCart((current) => current.filter((line) => !(line.productId === productId && line.size === size))),
    clearCart: () => setCart([]),
    toggleWishlist: (productId) => setWishlist((current) => current.includes(productId) ? current.filter((id) => id !== productId) : [...current, productId]),
  }), [cart, wishlist, catalogProducts, catalogQuery.isLoading, catalogQuery.error, cartCount, subtotal, shipping, total]);

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useStore() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useStore must be used inside StoreProvider");
  return context;
}

export function money(value: number) {
  return new Intl.NumberFormat("en-NG", { style: "currency", currency: "NGN", maximumFractionDigits: 0 }).format(value);
}
