import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { AgentScreen } from "../screens/agent";
import { AgentsScreen } from "../screens/agents";
import { ComingSoonScreen } from "../screens/comingSoon";
import { MarkBadge, MarketScreen } from "../screens/market";
import { MarketsScreen } from "../screens/markets";
import { PerpsFundsScreen } from "../screens/perpsFunds";
import { PortfolioScreen } from "../screens/portfolio";
import { ReadScreen } from "../screens/read";
import { SigninScreen } from "../screens/signin";
import { DepositScreen, WalletScreen, WithdrawScreen } from "../screens/wallet";
import { TabBar } from "../ui/TabBar";
import { withPage } from "../ui/Page";
import { C } from "../ui/theme";
import { flushPending, navigationRef } from "./ref";
import type { AgentsStackParamList, MarketsStackParamList, PortfolioStackParamList, RootParamList, SoloStackParamList, TabParamList, WalletStackParamList } from "./routes";

// Cabecera propia y gesto estándar de iOS (spec D6/D8).
const STACK: NativeStackNavigationOptions = { headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: false, animation: "default", contentStyle: { backgroundColor: C.bg } };

const Root = createNativeStackNavigator<RootParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();
const MarketsStack = createNativeStackNavigator<MarketsStackParamList>();
const AgentsStack = createNativeStackNavigator<AgentsStackParamList>();
const PortfolioStack = createNativeStackNavigator<PortfolioStackParamList>();
const WalletStack = createNativeStackNavigator<WalletStackParamList>();
const LaunchpadStack = createNativeStackNavigator<SoloStackParamList<"launchpad">>();
const ActivityStack = createNativeStackNavigator<SoloStackParamList<"activity">>();

const Markets = withPage("markets", MarketsScreen);
const Market = withPage("market", MarketScreen, { headerRight: MarkBadge });
const PerpsFunds = withPage("perpsFunds", PerpsFundsScreen);
const Wallet = withPage("wallet", WalletScreen);
const Deposit = withPage("deposit", DepositScreen);
const Withdraw = withPage("withdraw", WithdrawScreen);
const Launchpad = withPage("launchpad", (ctx) => <ComingSoonScreen screen="launchpad" requireAccount={ctx.requireAccount} />);
const Activity = withPage("activity", (ctx) => <ComingSoonScreen screen="activity" requireAccount={ctx.requireAccount} />);
const AgentsList = withPage("agents", AgentsScreen);
const AgentProfile = withPage("agent", AgentScreen, { bare: true });
const Portfolio = withPage("portfolio", PortfolioScreen);
const ReadView = withPage("read", ReadScreen);
const Signin = withPage("signin", SigninScreen);

function MarketsTab() {
  return (
    <MarketsStack.Navigator screenOptions={STACK}>
      <MarketsStack.Screen name="markets" component={Markets} />
      <MarketsStack.Screen name="market" component={Market} />
    </MarketsStack.Navigator>
  );
}
function AgentsTabNav() {
  return (
    <AgentsStack.Navigator screenOptions={STACK}>
      <AgentsStack.Screen name="agents" component={AgentsList} />
      <AgentsStack.Screen name="agent" component={AgentProfile} />
    </AgentsStack.Navigator>
  );
}
function PortfolioTabNav() {
  return (
    <PortfolioStack.Navigator screenOptions={STACK}>
      <PortfolioStack.Screen name="portfolio" component={Portfolio} />
      <PortfolioStack.Screen name="read" component={ReadView} />
    </PortfolioStack.Navigator>
  );
}
function WalletTab() {
  return (
    <WalletStack.Navigator screenOptions={STACK}>
      <WalletStack.Screen name="wallet" component={Wallet} />
      <WalletStack.Screen name="deposit" component={Deposit} />
      <WalletStack.Screen name="withdraw" component={Withdraw} />
      <WalletStack.Screen name="perpsFunds" component={PerpsFunds} />
    </WalletStack.Navigator>
  );
}
function LaunchpadTab() { return <LaunchpadStack.Navigator screenOptions={STACK}><LaunchpadStack.Screen name="launchpad" component={Launchpad} /></LaunchpadStack.Navigator>; }
function ActivityTab() { return <ActivityStack.Navigator screenOptions={STACK}><ActivityStack.Screen name="activity" component={Activity} /></ActivityStack.Navigator>; }

function TabsNav() {
  return (
    // backBehavior="none": el default v7 (`firstRoute`) deja `canGoBack()` en true en la raíz de cualquier pestaña
    // que no sea la primera (Markets); `goBackIfCan()` (ref.ts) saltaría entonces a MarketsTab en vez de no hacer nada.
    <Tabs.Navigator
      initialRouteName="WalletTab"
      backBehavior="none"
      tabBar={(p) => <TabBar {...p} />}
      screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: C.bg } }}
    >
      {/* Orden de ALL_TABS: las 4 visibles y luego Launchpad y Activity, registradas fuera de la barra (D1). */}
      <Tabs.Screen name="MarketsTab" component={MarketsTab} />
      <Tabs.Screen name="AgentsTab" component={AgentsTabNav} />
      <Tabs.Screen name="PortfolioTab" component={PortfolioTabNav} />
      <Tabs.Screen name="WalletTab" component={WalletTab} />
      <Tabs.Screen name="LaunchpadTab" component={LaunchpadTab} />
      <Tabs.Screen name="ActivityTab" component={ActivityTab} />
    </Tabs.Navigator>
  );
}

/** Árbol de navegación (spec D1). `initial`: Tabs con cuenta, signin sin ella (D5). */
export function Navigator({ initial }: { initial: "Tabs" | "signin" }) {
  return (
    <NavigationContainer ref={navigationRef} onReady={flushPending}>
      <Root.Navigator initialRouteName={initial} screenOptions={STACK}>
        <Root.Screen name="Tabs" component={TabsNav} />
        <Root.Screen name="signin" component={Signin} />
      </Root.Navigator>
    </NavigationContainer>
  );
}
