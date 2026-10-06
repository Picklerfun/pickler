"use client";

import Image from "next/image";
import Link from "next/link";
import { Button, Icon } from "@pickler/ui";
import { useStudioHref } from "@/features/site/studio-href";
import { StudioSkeleton } from "../skeleton";
import { RAIL } from "../sections/rail";
import home from "../home/home.module.css";
import studio from "../studio.module.css";

/** Keep the modern Studio frame while its session and agent selection are still unresolved. */
export function StudioPending({ error, onRetry }: { error: string; onRetry(): void }) {
  const href = useStudioHref();

  return (
    <main className={home.home} data-surface="dark" id="studio-pending">
      <header className={home.top}>
        <Link href={href} className={home.brand}>
          <Image src="/brand/logo.png" alt="" width={22} height={23} priority />
          <span>PICKLER</span>
        </Link>
        <span className={home.spacer} />
        <span className={home.pill} data-tint="grey">
          TESTNET
        </span>
        <Link href="/account" className={home.account} aria-label="Account">
          <span className={studio.swatch} aria-hidden="true">
            <i data-swatch="lime" />
            <i data-swatch="violet" />
            <i data-swatch="amber" />
            <i data-swatch="blue" />
          </span>
        </Link>
      </header>
      <div className={home.emptyBody}>
        <nav className={home.emptyRail} aria-label="Studio sections" aria-busy={!error}>
          {RAIL.map((group) => (
            <div key={group.title}>
              <p className={studio.railTitle}>{group.title}</p>
              <div className={studio.railItems}>
                {group.items.map((item) => (
                  <span key={item.key} className={home.emptyRailItem} aria-disabled="true">
                    <Icon name={item.icon} size={17} />
                    <span className={studio.railLabel}>{item.label}</span>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className={home.emptyMain}>
          {error ? (
            <section role="alert">
              <h1 className={studio.stubTitle}>Could not open Studio</h1>
              <p className={studio.stubBody}>{error}</p>
              <Button onClick={onRetry}>Try again</Button>
            </section>
          ) : (
            <StudioSkeleton />
          )}
        </div>
      </div>
    </main>
  );
}
