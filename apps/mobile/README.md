# Pickler mobile

Fase 1: cuenta EVM derivada de una passkey (mera + PRF), guardada con gate
biométrico en el dispositivo, con balances de AUSD/MON en Monad Testnet y un
botón para pedir AUSD de prueba al faucet de Agora.

## Correr en simulador

```bash
npx expo prebuild --platform ios --clean   # genera ./ios (gitignored)
npx expo run:ios                            # build + instala en el simulador por defecto
npx expo start                              # metro, si necesitas recargar JS sin rebuild nativo
```

`expo run:ios` levanta metro automáticamente la primera vez; si lo cierras,
`npx expo start` lo vuelve a levantar y la app conectada lo detecta sola.

Para elegir un simulador o device específico: `npx expo run:ios --device <nombre-o-udid>`.
Ojo: el UDID que hay que pasar es el de `hardwareProperties.udid` en
`xcrun devicectl list devices --json-output out.json` (formato clásico
`00008140-...`), **no** el `Identifier` que imprime la tabla de
`xcrun devicectl list devices` (ese es un UUID de emparejamiento distinto).

## Tests

```bash
npm test          # jest, 19/19 esperado
npx tsc --noEmit   # debe salir limpio
```

## Dominio de passkeys (Associated Domains)

El RP ID es `pickler.fun` (`ios.associatedDomains: ["webcredentials:pickler.fun"]`
en `app.config.ts`). Verificar que el AASA esté vivo y bien formado:

```bash
curl -sI https://pickler.fun/.well-known/apple-app-site-association | head -5
# esperado: 200, content-type application/json (aunque no tenga extensión .json)
```

El App ID `fun.pickler.app` tiene la capability **Associated Domains** habilitada
en developer.apple.com (Identifiers). Se registra sola la primera vez que se hace
un build de device o un archive con `-allowProvisioningUpdates` (ver abajo).

## Subir a TestFlight

Requiere `apps/mobile/.env.asc` (gitignored, **nunca se commitea**) con:

```
ASC_KEY_ID=...
ASC_ISSUER_ID=...
```

La misma App Store Connect API key que usa Proflores (team `2PBQJ37Q8W`), con el
`.p8` en `~/.appstoreconnect/private_keys/AuthKey_<ASC_KEY_ID>.p8`. Y una
identidad **Apple Distribution** en el llavero (Xcode → Settings → Accounts →
Manage Certificates → + → Apple Distribution).

```bash
npm run ios:archive   # xcodebuild archive + export -> build/export/Pickler.ipa
npm run ios:upload    # xcrun altool --upload-app
```

`ios:upload` falla con exit 1 si detecta "UPLOAD FAILED" / "ERROR ITMS" /
"Validation failed" en la salida de `altool`, aunque `altool` mismo haya salido
con 0.

**Regla del buildNumber:** cada subida a TestFlight necesita un `ios.buildNumber`
distinto en `app.config.ts` (App Store Connect rechaza un build ya subido para la
misma versión). Súbelo antes de repetir `npm run ios:archive`.

Después de "✓ subida aceptada": App Store Connect → TestFlight tarda unos
minutos en pasar el build de "Processing" a listo para testers. Agregar a los
testers al grupo interno correspondiente.

## Conseguir MON de testnet

La cuenta necesita gas (MON) antes de poder pedir AUSD del faucet:

1. Copiar la dirección desde la pantalla *Treasury* (botón "Copy address").
2. `https://faucet.monad.xyz` → pegar la dirección → pedir MON de testnet.
   (O que alguien con MON de testnet te transfiera ~0.1 MON directo.)
3. Refrescar el balance en la app (botón "Retry" si hubo error de RPC, o
   reabrir la app) hasta ver MON > 0.
4. *Get test AUSD* pide una firma (Face ID) y manda la tx al faucet de AUSD
   (`0xd236c18D274E54FAccC3dd9DDA4b27965a73ee6C`); espera "Confirmed: 0x…".
