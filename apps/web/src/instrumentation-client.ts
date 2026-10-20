import posthog from "posthog-js";
import {
  POSTHOG_PROXY_PATH,
  posthogProjectKey,
  posthogUiHost,
  shareAnalyticsCookie,
} from "./features/analytics/config";

/**
 * Client-only. Next runs this file before hydration and never on the server.
 * `defaults: "2026-05-30"` captures pageviews on history changes (App Router navigations) and
 * pageleaves with them, and injects PostHog's scripts into `<head>` so they do not disturb SSR.
 * Session replay stays off. Input masking is set anyway, so a later recording flag cannot record
 * what someone types. The email is not an identify id: see `features/analytics/events.ts`.
 */
posthog.init(posthogProjectKey(), {
  api_host: POSTHOG_PROXY_PATH,
  ui_host: posthogUiHost(),
  defaults: "2026-05-30",
  capture_pageview: "history_change",
  capture_pageleave: true,
  autocapture: true,
  disable_session_recording: true,
  session_recording: { maskAllInputs: true },
  mask_personal_data_properties: true,
  custom_personal_data_properties: ["email"],
  cross_subdomain_cookie: shareAnalyticsCookie(window.location.hostname),
  before_send(event) {
    if (event.properties) {
      delete event.properties.email;
      delete event.properties.$email;
    }
    return event;
  },
});
