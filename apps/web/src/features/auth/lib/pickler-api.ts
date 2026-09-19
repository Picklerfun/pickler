"use client";

import { authConfig } from "./config";

export interface ProfileDto {
  user_id: string;
  display_name: string;
  handle: string;
  created_at: string;
}

export type HandleAvailability =
  | { handle: string; available: true }
  | {
      handle: string;
      available: false;
      reason: "too_short" | "too_long" | "invalid_characters" | "reserved" | "taken";
    };

interface Envelope<T> {
  success: boolean;
  message: string;
  data?: T;
  error?: string;
  reason?: string;
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string | undefined,
    readonly reason: string | undefined,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function call<T>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.token) {
    headers.set("Authorization", `Bearer ${init.token}`);
  }
  if (init.body) {
    headers.set("Content-Type", "application/json");
  }
  let response: Response;
  try {
    response = await fetch(`${authConfig.apiUrl}${path}`, { ...init, headers });
  } catch {
    throw new ApiError(
      0,
      "Could not reach Pickler. Check your connection and try again.",
      "network",
      undefined,
    );
  }
  const body = (await response.json().catch(() => null)) as Envelope<T> | null;
  if (!response.ok || !body?.success) {
    throw new ApiError(
      response.status,
      body?.message ?? "Something went wrong",
      body?.error,
      body?.reason,
    );
  }
  return body.data as T;
}

export const checkHandle = (handle: string, signal?: AbortSignal) =>
  call<HandleAvailability>(
    `/v1/handles/${encodeURIComponent(handle)}/availability`,
    signal ? { signal } : {},
  );

export const getProfile = (token: string) => call<ProfileDto>("/v1/profile", { token });

export const createProfile = (token: string, input: { displayName: string; handle: string }) =>
  call<ProfileDto>("/v1/profile", {
    method: "POST",
    token,
    body: JSON.stringify({ display_name: input.displayName, handle: input.handle }),
  });
