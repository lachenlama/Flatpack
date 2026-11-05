import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { CONTRACT_NAMES, DeploymentError, parseDeployment, validateDeployment } from "./deployment.ts";

const A = (n: number): string => `0x${n.toString(16).padStart(40, "0")}`;
const good = {
  chainId: 4663,
  deployedAt: "2026-11-05T18:50:12.188Z",
  blockNumber: 123,
  addresses: { ComponentRegistry: A(1), BackingVault: A(2), FeeHarvester: A(3), BasketFactory: A(4), FlatpackRouter: A(5), BasketImplementation: A(6) },
};

test("validateDeployment accepts a full deployment and returns all 6 contracts", () => {
  const d = validateDeployment(good);
  assert.equal(d.blockNumber, 123);
  assert.deepEqual(Object.keys(d.addresses).sort(), [...CONTRACT_NAMES].sort());
});

test("legacy Basket key is accepted as BasketImplementation", () => {
  const { BasketImplementation, ...rest } = good.addresses;
  void BasketImplementation;
  const d = validateDeployment({ ...good, addresses: { ...rest, Basket: A(9) } });
  assert.equal(d.addresses.BasketImplementation, A(9));
});

test("validateDeployment rejects bad input", () => {
  assert.throws(() => validateDeployment(null), DeploymentError);
  assert.throws(() => validateDeployment({ ...good, chainId: 1 }), /chainId/);
  assert.throws(() => validateDeployment({ ...good, blockNumber: -1 }), /blockNumber/);
  assert.throws(() => validateDeployment({ ...good, addresses: { ...good.addresses, FeeHarvester: "nope" } }), /FeeHarvester/);
  assert.throws(() => validateDeployment({ ...good, addresses: { ...good.addresses, BasketFactory: undefined } }), /BasketFactory/);
});

test("parseDeployment explains a missing deployment", () => {
  assert.throws(() => parseDeployment(undefined), /NEXT_PUBLIC_DEPLOYMENT/);
  assert.equal(parseDeployment(JSON.stringify(good)).chainId, 4663);
});

test("the real shared/deployments/rehearsal.json (when present) validates", () => {
  const f = fileURLToPath(new URL("../../../shared/deployments/rehearsal.json", import.meta.url));
  if (!existsSync(f)) return;
  const d = validateDeployment(JSON.parse(readFileSync(f, "utf8")));
  assert.equal(Object.keys(d.addresses).length, 6);
});
