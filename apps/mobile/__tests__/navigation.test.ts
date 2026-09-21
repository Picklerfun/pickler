// Red unitaria de la navegación v7 (spec mobile-nav D2/D5, hallazgo F1 de la revisión final). Dos bloques:
// (a) el StackRouter real de @react-navigation/routers, para dejar en código la semántica de `pop` que el
//     comentario de src/navigation/ref.ts describe en prosa; (b) la forma exacta de las órdenes que el
//     adaptador manda a `navigationRef` (navigateTo/switchTab/resetRootTo), con un ref simulado.

import { CommonActions, StackRouter } from "@react-navigation/routers";

describe("StackRouter (@react-navigation/routers) — semántica de pop en NAVIGATE", () => {
  // Firma real (node_modules/@react-navigation/routers/lib/typescript/src/CommonActions.d.ts):
  //   function navigate(name: string, params?: object, options?: { merge?: boolean; pop?: boolean }): Action;
  // (la forma con un solo objeto `{ name, ... }` es la variante `@deprecated`).
  test("navigate with pop returns to the existing route (v7)", () => {
    const router = StackRouter({});
    const options = { routeNames: ["Tabs", "signin"], routeParamList: {}, routeGetIdList: {} };
    let state = router.getInitialState(options);
    // getStateForAction devuelve `State | PartialState<State> | null` (tipo genérico del Router); en este router y
    // esta acción siempre es un state completo, así que se castea de vuelta al tipo de `state` para reencadenar.
    state = router.getStateForAction(state, CommonActions.navigate("signin"), options) as typeof state;
    expect(state.routes.map((r) => r.name)).toEqual(["Tabs", "signin"]);

    const backToTabs = router.getStateForAction(state, CommonActions.navigate("Tabs", undefined, { pop: true }), options) as typeof state;
    expect(backToTabs.routes.map((r) => r.name)).toEqual(["Tabs"]);

    // Segundo caso: pila de una pestaña (markets → market), pop:true vuelve a la ruta existente en vez de duplicarla.
    const router2 = StackRouter({});
    const options2 = { routeNames: ["markets", "market", "perpsFunds"], routeParamList: {}, routeGetIdList: {} };
    let state2 = router2.getInitialState(options2);
    state2 = router2.getStateForAction(state2, CommonActions.navigate("market"), options2) as typeof state2;
    expect(state2.routes.map((r) => r.name)).toEqual(["markets", "market"]);

    const backToMarkets = router2.getStateForAction(state2, CommonActions.navigate("markets", undefined, { pop: true }), options2) as typeof state2;
    expect(backToMarkets.routes.map((r) => r.name)).toEqual(["markets"]);
  });

  test("navigate without pop pushes a duplicate route (v7)", () => {
    const router = StackRouter({});
    const options = { routeNames: ["Tabs", "signin"], routeParamList: {}, routeGetIdList: {} };
    let state = router.getInitialState(options);
    state = router.getStateForAction(state, CommonActions.navigate("signin"), options) as typeof state;

    // Sin `pop`, NAVIGATE apila de nuevo aunque `Tabs` ya esté debajo (la razón de que ref.ts siempre mande pop:true).
    const pushed = router.getStateForAction(state, CommonActions.navigate("Tabs"), options) as typeof state;
    expect(pushed.routes.map((r) => r.name)).toEqual(["Tabs", "signin", "Tabs"]);
  });
});

describe("navigation/ref adapter — forma exacta de las órdenes a navigationRef", () => {
  // El mock vive ENTERO dentro de la factory de jest.mock: los imports de un módulo (incluido el de
  // "../src/navigation/ref" más abajo) se transpilan a `require` que Babel coloca ANTES que cualquier
  // otra sentencia del archivo — antes incluso de una `const mockRef = {...}` escrita después del
  // `jest.mock(...)` en el código fuente. Si `mockRef` viviera fuera de la factory, `ref.ts` llamaría a
  // `createNavigationContainerRef()` cuando esa constante externa todavía es `undefined` (verificado:
  // sin este patrón, `navigationRef` queda `undefined` en el adaptador). Con el objeto creado dentro de
  // la factory, la clausura garantiza el mismo objeto en cada llamada, sin depender del orden de líneas.
  jest.mock("@react-navigation/native", () => {
    const ref = {
      isReady: () => true,
      navigate: jest.fn(),
      goBack: jest.fn(),
      canGoBack: () => true,
      resetRoot: jest.fn(),
      getCurrentRoute: () => undefined,
      getRootState: () => undefined,
      addListener: () => () => {},
    };
    return { createNavigationContainerRef: () => ref };
  });

  // eslint-disable-next-line @typescript-eslint/no-var-requires -- necesitamos el mismo objeto simulado que ref.ts obtuvo.
  const { createNavigationContainerRef } = require("@react-navigation/native");
  const ref = createNavigationContainerRef() as {
    navigate: jest.Mock;
    resetRoot: jest.Mock;
  };

  // Import normal: al ejecutarse (hoisted por Babel), "@react-navigation/native" ya está mockeado arriba.
  const { navigateTo, switchTab, resetRootTo } = require("../src/navigation/ref");

  afterEach(() => {
    ref.navigate.mockClear();
    ref.resetRoot.mockClear();
  });

  test("navigateTo a pantalla no raíz anida params con initial:false y pop:true", () => {
    navigateTo("market");
    expect(ref.navigate).toHaveBeenCalledWith(
      "Tabs",
      { screen: "MarketsTab", params: { screen: "market", initial: false, pop: true } },
      { pop: true },
    );
  });

  test("navigateTo a la raíz de una pestaña no manda initial (D10)", () => {
    navigateTo("wallet");
    expect(ref.navigate).toHaveBeenCalledWith(
      "Tabs",
      { screen: "WalletTab", params: { screen: "wallet", pop: true } },
      { pop: true },
    );
  });

  test("switchTab sólo enfoca la pestaña, sin params anidados", () => {
    switchTab("MarketsTab");
    expect(ref.navigate).toHaveBeenCalledWith("Tabs", { screen: "MarketsTab" }, { pop: true });
  });

  test("navigateTo signin manda los params de vuelta (next/patch) sin pop", () => {
    navigateTo("signin", { next: "markets" });
    expect(ref.navigate).toHaveBeenCalledWith("signin", { next: "markets" });
  });

  test("resetRootTo deja una sola ruta en el RootStack", () => {
    resetRootTo("signin");
    expect(ref.resetRoot).toHaveBeenCalledWith({ index: 0, routes: [{ name: "signin" }] });
  });
});
