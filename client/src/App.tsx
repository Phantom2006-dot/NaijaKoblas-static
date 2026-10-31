import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/NotFound";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { StoreProvider } from "./store";
import { StoreShell } from "./components/store/StoreShell";
import { AboutPage, CartPage, CheckoutPage, ContactPage, HomePage, InfoPage, OrderConfirmationPage, ProductDetailPage, ProductsPage, VendorPage, WaitlistPage } from "./pages/StorePages";
import { AccountPage, SuspendedSellerFulfillmentPage } from "./pages/AccountPages";
import { AuthPage } from "./pages/AuthPage";
import { AdminAccessPage } from "./pages/AdminAccessPage";
import { SellerWorkspacePage } from "./pages/SellerWorkspacePage";
import { StaffWorkspacePage } from "./pages/StaffWorkspacePage";

function Router() {
  const [location] = useLocation();
  const routes = <Switch>
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
    <Route path="/seller-fulfillment" component={SuspendedSellerFulfillmentPage} />
    <Route path="/seller" component={SellerWorkspacePage} />
    <Route path="/staff" component={StaffWorkspacePage} />
    <Route path="/admin" component={AdminAccessPage} />
    <Route path="/info/:topic" component={InfoPage} />
    <Route path="/404" component={NotFound} />
    <Route component={NotFound} />
  </Switch>;
  return location === "/admin" || location.startsWith("/admin/") ? routes : <StoreShell>{routes}</StoreShell>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="dark" switchable><TooltipProvider><Toaster /><StoreProvider><Router /></StoreProvider></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
