"use client";

import { cloneElement, type MouseEvent, type ReactElement } from "react";
import { captureCta } from "./client";

type Clickable = {
  onClick?: (event: MouseEvent<HTMLElement>) => void;
};

/** Fires `cta_clicked`, then the child's own click handler. Adds no DOM node. */
export function TrackCta({
  cta,
  location,
  children,
}: {
  cta: string;
  location: string;
  children: ReactElement<Clickable>;
}) {
  const childClick = children.props.onClick;
  return cloneElement(children, {
    onClick: (event: MouseEvent<HTMLElement>) => {
      captureCta(cta, location);
      childClick?.(event);
    },
  });
}
