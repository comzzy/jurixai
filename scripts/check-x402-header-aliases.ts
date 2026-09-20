import assert from "node:assert/strict";
import { resolveX402PaymentHeader } from "../src/lib/x402/payment-header.ts";

const payload = Buffer.from(
  JSON.stringify({
    x402Version: 2,
    resource: {
      url: "https://www.jurixai.xyz/api/judge",
      description: "Header compatibility check",
      mimeType: "application/json",
    },
    accepted: {
      scheme: "exact",
      network: "eip155:5042",
      amount: "1000",
      asset: "0x3600000000000000000000000000000000000000",
      payTo: "0xF7Eed64C05C211ec458903611e5ec5492D399b58",
      maxTimeoutSeconds: 300,
      extra: { name: "USDC", version: "2" },
    },
    payload: {
      signature: "0xsignature",
      authorization: { nonce: "0xnonce" },
    },
  }),
).toString("base64");

assert.equal(resolveX402PaymentHeader(new Headers({ "PAYMENT-SIGNATURE": payload })), payload);
assert.equal(resolveX402PaymentHeader(new Headers({ "X-PAYMENT": payload })), payload);
assert.equal(
  resolveX402PaymentHeader(new Headers({ "PAYMENT-SIGNATURE": "canonical", "X-PAYMENT": payload })),
  "canonical",
);
assert.equal(resolveX402PaymentHeader(new Headers({ "X-PAYMENT": "invalid" })), undefined);
assert.equal(
  resolveX402PaymentHeader(new Headers({ Authorization: `Payment ${payload}` })),
  payload,
);
assert.equal(
  resolveX402PaymentHeader(new Headers({ Authorization: `Bearer ${payload}` })),
  payload,
);
assert.equal(resolveX402PaymentHeader(new Headers({ Authorization: payload })), payload);
assert.equal(resolveX402PaymentHeader(new Headers({ Authorization: "Bearer invalid" })), undefined);

console.log("x402 header alias checks passed");
