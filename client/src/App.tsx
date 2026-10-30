import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { StoreProvider } from "./store";
import { StoreShell } from "./components/store/StoreShell";
import { AboutPage, AuthPage, CartPage, CheckoutPage, ContactPage, HomePage, InfoPage, OrderConfirmationPage, ProductDetailPage, ProductsPage, VendorPage, WaitlistPage } from "./pages/StorePages";
import { AccountPage, AdminDashboardPage, SellerDashboardPage, StaffDashboardPage } from "./pages/AccountPages";

function Router() {
  return <StoreShell><Switch>
    <Route path="/" component={HomePage} />
    <Route path="/products" component={ProductsPage} />
    <Route path="/products/:id" component={ProductDetailPage} />
    <Route path="/cart" component={CartPage} />
    <Route path="/checkout" component={CheckoutPage} />
    <Route path="/order-confirmation" component={OrderConfirmationPage} />
    <Route path="/about" component={AboutPage} />
    <Route path="/contact" component={ContactPage} />
    <Route path="/vendor" component={VendorPage} />
    <Route path="/login" component={() => <AuthPage />} />
    <Route path="/signup" component={() => <AuthPage signup />} />
    <Route path="/waitlist" component={WaitlistPage} />
    <Route path="/account" component={AccountPage} />
    <Route path="/seller" component={SellerDashboardPage} />
    <Route path="/staff" component={StaffDashboardPage} />
    <Route path="/admin" component={AdminDashboardPage} />
    <Route path="/info/:topic" component={InfoPage} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch></StoreShell>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark" switchable><TooltipProvider><Toaster /><StoreProvider><Router /></StoreProvider></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
