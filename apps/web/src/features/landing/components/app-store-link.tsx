import type { ReactNode } from "react";

/**
 * The App Store control, which is a link only when there is somewhere to send people. Without
 * `NEXT_PUBLIC_APP_STORE_URL` it is drawn but disabled, with the reason where a pointer or a screen
 * reader finds it, rather than a link to nowhere.
 *
 * `surface` is the surface the pill takes, which is the opposite of the ground it sits on: dark on
 * the white page, light in the dark closing block.
 */
export function AppStoreLink({
  url,
  surface,
  className,
  children,
}: {
  url: string | null;
  surface: "light" | "dark";
  className: string;
  children: ReactNode;
}) {
  if (url) {
    return (
      <a
        href={url}
        className={className}
        data-surface={surface}
        target="_blank"
        rel="noreferrer noopener"
      >
        {children}
      </a>
    );
  }
  return (
    <span
      className={className}
      data-surface={surface}
      role="link"
      aria-disabled="true"
      title="The TestFlight link is not public yet"
    >
      {children}
    </span>
  );
}
