/**
 * Thin fetch wrapper for MDR's API — mirrors src/vapi/client.ts's pattern.
 * Points at the mock service (src/mock-mdr-api/) by default; swapping to the
 * real MDR API once available is a MDR_API_BASE_URL/MDR_API_KEY change only.
 */
const MDR_API_BASE_URL = process.env.MDR_API_BASE_URL ?? "http://localhost:4000/api/everly";
const MDR_API_KEY = process.env.MDR_API_KEY ?? "mock-api-key";

export class MdrApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`MDR API error (${status}): ${JSON.stringify(body)}`);
  }
}

async function request<T>(
  method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  const res = await fetch(`${MDR_API_BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${MDR_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  const data = text ? JSON.parse(text) : undefined;

  if (!res.ok) {
    throw new MdrApiError(res.status, data);
  }

  return data as T;
}

export const mdr = {
  get: <T>(path: string) => request<T>("GET", path),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body),
  patch: <T>(path: string, body?: unknown) => request<T>("PATCH", path, body),
};
