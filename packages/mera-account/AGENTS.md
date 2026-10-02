# Mera account package instructions

Read [the root instructions](../../AGENTS.md) first, and
[the specification](../../docs/specs/mobile-monorepo-v1.md) that created this package.

`@pickler/mera-account` is the one rule that turns a Mera passkey into the marketplace account, on
every surface: 32 bytes of WebAuthn PRF output → a 24-word BIP-39 mnemonic (English list) → the
BIP-39 seed with an empty passphrase → the BIP-32 key at `m/44'/60'/0'/0/<index>`, index 0 for the
account. It exports `prfOutputToMnemonic`, `mnemonicToSeed` and `deriveEvmPrivateKey` from
`src/index.ts`, and the vectors as `@pickler/mera-account/vectors.json`. It has two consumers: the
mobile app (`apps/mobile/src/wallet/wallet.ts`) and the web marketplace's passkey wallet
(`apps/web/src/features/wallet/lib/mera-kit.ts`, the only web module allowed to import it; its
ceremony is tested against the same vectors in `apps/web/test/mera-ceremony.test.ts`). Any other
Mera signer must use it too, or the same passkey opens a different address there.

- **The rule does not change.** A different word list, passphrase, path, or the PRF output used as
  the key directly, each gives every person a new address and strands what the old one holds.
- **`test/vectors.json` is never regenerated.** It was produced on 2026-10-01 by the app's code
  before that code moved here. A change that makes a vector fail is wrong; the file is not. The
  first vector is the well-known all-zero entropy mnemonic, which any BIP-39 tool reproduces.
- Keep the package free of React, React Native, the Mera SDK, and viem at run time (viem is a
  development dependency of the test only). It must load in Metro, in a browser bundle and in Node.
- Keep `@scure/bip32` and `@scure/bip39` pinned exactly. The app bundles this package's copies.
- Callers own the key material: they zero the PRF output, the seed and the private key after use.
  Nothing here stores or logs them. `deriveEvmPrivateKey` hands back a copy of the key and wipes
  every HD node it derived through — the master included — with its chain code, so the caller's
  copy is the only one left (`test/derivation.test.ts` pins it). The mnemonic is a string and
  cannot be wiped; do not add an API that returns or keeps it for longer than a derivation.

From the root: `node --import tsx --test packages/mera-account/test/*.test.ts` (also part of
`npm test`), `npm run typecheck --workspace=@pickler/mera-account`, and
`npm test --workspace=@pickler/mobile`, whose `__tests__/hd.test.ts` reads the same vectors through
the app's resolver.
