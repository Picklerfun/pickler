/**
 * Third-party wordmarks, kept apart from `Icon` on purpose.
 *
 * `Icon` is Lucide: one stroke weight, `currentColor`, and a name per idea. Neither of these fits
 * that. Google's mark is four fixed fills that may not be recoloured, and `Icon`'s `x` is the
 * close cross — putting the X wordmark under the same name would give "dismiss" and "sign in with
 * X" the same glyph, and one of the two buttons would be wrong wherever it was used.
 *
 * Authentication marks use the "Pickler Auth Passkey Flow" canvas’s 24×24 grid.
 * Agora keeps the geometry and viewBox from its official brand kit.
 */

export type BrandName = "google" | "x" | "ausd";

export function BrandMark({ name, size = 18 }: { name: BrandName; size?: number }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox={name === "ausd" ? "0 0 227 222" : "0 0 24 24"}
      aria-hidden="true"
      focusable="false"
      // The design checks skip what sits under this: a third party's colours are not tokens.
      data-third-party-mark=""
    >
      {name === "google" ? (
        <>
          <path
            fill="#4285F4"
            d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
          />
          <path
            fill="#34A853"
            d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
          />
          <path
            fill="#FBBC05"
            d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z"
          />
          <path
            fill="#EA4335"
            d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
          />
        </>
      ) : name === "ausd" ? (
        // Official Agora mark: https://www.agora.finance/agora-brandkit/agora-bug--dark-mode.svg
        <path
          fill="currentColor"
          d="M107.9 0v88.1c0 3.7-4.4 5.5-7 2.9L59.4 50.5 76.8 5.3C78 2.1 81.1 0 84.5 0zM107.9 120v49.5c0 3.3-3.9 4.9-6.3 2.7l-64.3-60.6 18.9-49 46.9 45.9c3.1 3 4.8 7.1 4.8 11.5M107.9 199.8V222H8.2c-5.7 0-9.7-5.8-7.6-11.1l33.4-87 69.3 65.4c3 2.7 4.6 6.5 4.6 10.5M118.6 0v88.1c0 3.7 4.4 5.5 7 2.9L167 50.5 149.7 5.3C148.4 2.1 145.4 0 142 0zM118.6 120v49.5c0 3.3 3.9 4.9 6.3 2.7l64.3-60.6-18.9-49-46.9 45.9c-3.1 3-4.9 7.1-4.9 11.5zM118.6 199.8V222h99.6c5.8 0 9.8-5.8 7.7-11.1l-33.5-87-69.3 65.4c-2.9 2.7-4.5 6.5-4.5 10.5"
        />
      ) : (
        // A single shape, so it takes the surrounding text colour like a letterform should.
        <path
          fill="currentColor"
          d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"
        />
      )}
    </svg>
  );
}
