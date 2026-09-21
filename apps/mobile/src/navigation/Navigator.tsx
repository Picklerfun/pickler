import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { NavigationContainer } from "@react-navigation/native";
import { createNativeStackNavigator, type NativeStackNavigationOptions } from "@react-navigation/native-stack";
import { ComingSoonScreen } from "../screens/comingSoon";
import { MarketScreen } from "../screens/market";
import { MarketsScreen } from "../screens/markets";
import { PerpsFundsScreen } from "../screens/perpsFunds";
import { SigninScreen } from "../screens/signin";
import { DepositScreen, WalletScreen, WithdrawScreen } from "../screens/wallet";
import { TabBar } from "../ui/TabBar";
import { withPage } from "../ui/Page";
import { C } from "../ui/theme";
import { flushPending, navigationRef } from "./ref";
import type { MarketsStackParamList, RootParamList, SoloStackParamList, TabParamList, WalletStackParamList } from "./routes";

// Cabecera propia y gesto estándar de iOS (spec D6/D8).
const STACK: NativeStackNavigationOptions = { headerShown: false, gestureEnabled: true, fullScreenGestureEnabled: false, animation: "default", contentStyle: { backgroundColor: C.bgBottom } };

const Root = createNativeStackNavigator<RootParamList>();
const Tabs = createBottomTabNavigator<TabParamList>();
const MarketsStack = createNativeStackNavigator<MarketsStackParamList>();
const WalletStack = createNativeStackNavigator<WalletStackParamList>();
const LaunchpadStack = createNativeStackNavigator<SoloStackParamList<"launchpad">>();
const ActivityStack = createNativeStackNavigator<SoloStackParamList<"activity">>();
const PortfolioStack = createNativeStackNavigator<SoloStackParamList<"portfolio">>();

const Markets = withPage("markets", MarketsScreen);
const Market = withPage("market", MarketScreen);
const PerpsFunds = withPage("perpsFunds", PerpsFundsScreen);
const Wallet = withPage("wallet", WalletScreen);
const Deposit = withPage("deposit", DepositScreen);
const Withdraw = withPage("withdraw", WithdrawScreen);
const Launchpad = withPage("launchpad", (ctx) => <ComingSoonScreen screen="launchpad" requireAccount={ctx.requireAccount} />);
const Activity = withPage("activity", (ctx) => <ComingSoonScreen screen="activity" requireAccount={ctx.requireAccount} />);
const Portfolio = withPage("portfolio", (ctx) => <ComingSoonScreen screen="portfolio" requireAccount={ctx.requireAccount} />);
const Signin = withPage("signin", SigninScreen);

function MarketsTab() {
  return (
    <MarketsStack.Navigator screenOptions={STACK}>
      <MarketsStack.Screen name="markets" component={Markets} />
      <MarketsStack.Screen name="market" component={Market} />
      <MarketsStack.Screen name="perpsFunds" component={PerpsFunds} />
    </MarketsStack.Navigator>
  );
}
function WalletTab() {
  return (
    <WalletStack.Navigator screenOptions={STACK}>
      <WalletStack.Screen name="wallet" component={Wallet} />
      <WalletStack.Screen name="deposit" component={Deposit} />
      <WalletStack.Screen name="withdraw" component={Withdraw} />
    </WalletStack.Navigator>
  );
}
function LaunchpadTab() { return <LaunchpadStack.Navigator screenOptions={STACK}><LaunchpadStack.Screen name="launchpad" component={Launchpad} /></LaunchpadStack.Navigator>; }
function ActivityTab() { return <ActivityStack.Navigator screenOptions={STACK}><ActivityStack.Screen name="activity" component={Activity} /></ActivityStack.Navigator>; }
function PortfolioTab() { return <PortfolioStack.Navigator screenOptions={STACK}><PortfolioStack.Screen name="portfolio" component={Portfolio} /></PortfolioStack.Navigator>; }

function TabsNav() {
  return (
    <Tabs.Navigator initialRouteName="WalletTab" tabBar={(p) => <TabBar {...p} />} screenOptions={{ headerShown: false, animation: "none", sceneStyle: { backgroundColor: C.bgBottom } }}>
      <Tabs.Screen name="MarketsTab" component={MarketsTab} />
      <Tabs.Screen name="LaunchpadTab" component={LaunchpadTab} />
      <Tabs.Screen name="ActivityTab" component={ActivityTab} />
      <Tabs.Screen name="PortfolioTab" component={PortfolioTab} />
      <Tabs.Screen name="WalletTab" component={WalletTab} />
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
