import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { lazy, Suspense } from "react";
import NotFound from "@/pages/NotFound";
import { Route, Switch } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import Home from "./pages/Home";

const Dashboard = lazy(() => import("./pages/Dashboard"));
const CreateRequest = lazy(() => import("./pages/CreateRequest"));
const Checkout = lazy(() => import("./pages/Checkout"));
const PublicReceiptPage = lazy(() => import("./pages/PublicReceiptPage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const OrdersPage = lazy(() => import("./pages/OrdersPage"));
const PayboxPage = lazy(() => import("./pages/PayboxPage"));
const PaymentDetailPage = lazy(() => import("./pages/PaymentDetailPage"));
const ReceiptsPage = lazy(() => import("./pages/ReceiptsPage"));
const SettingsPage = lazy(() => import("./pages/SettingsPage"));
const WorkflowsPage = lazy(() => import("./pages/WorkflowsPage"));

function Router() {
  return <Suspense fallback={<main className="loading-state" role="status">Loading LEXI PayLink…</main>}>
    <Switch>
      <Route path="/" component={Home}/>
      <Route path="/dashboard" component={Dashboard}/>
      <Route path="/create" component={CreateRequest}/>
      <Route path="/pay/:paymentId">{params => <Checkout paymentId={params.paymentId}/>}</Route>
      <Route path="/receipt/:paymentId">{params => <PublicReceiptPage paymentId={params.paymentId}/>}</Route>
      <Route path="/payments/:id">{params => <PaymentDetailPage id={Number(params.id)}/>}</Route>
      <Route path="/receipts" component={ReceiptsPage}/>
      <Route path="/orders" component={OrdersPage}/>
      <Route path="/workflows">{() => <WorkflowsPage/>}</Route>
      <Route path="/workflows/simulator">{() => <WorkflowsPage simulatorOnly/>}</Route>
      <Route path="/activity" component={ActivityPage}/>
      <Route path="/settings" component={SettingsPage}/>
      <Route path="/paybox" component={PayboxPage}/>
      <Route path="/404" component={NotFound}/>
      <Route component={NotFound}/>
    </Switch>
  </Suspense>;
}

export default function App() {
  return <ErrorBoundary><ThemeProvider defaultTheme="light" switchable><TooltipProvider><Toaster/><Router/></TooltipProvider></ThemeProvider></ErrorBoundary>;
}
