import { createOrasStorage } from "../../../../src/index.ts";

/**
 * Storage loader backed by an OCI Registry / ORAS.
 * Resolves keys like "product/1/portrait" and "product/1/portrait:2020" directly against the registry.
 */
export default createOrasStorage({
  hostname: process.env.OCI_REGISTRY_HOST || "localhost:5000",
  insecure: true,
  defaultTag: "latest",
});
