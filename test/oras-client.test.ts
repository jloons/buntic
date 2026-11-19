import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  OrasClient,
  createOrasStorage,
  parseOciReference,
  formatOciReference,
  AuthManager,
  parseWwwAuthenticate,
} from "../src/index.ts";

describe("ORAS & OCI Registry Module", () => {
  describe("Reference Parser & Formatter", () => {
    test("parses full reference with host, port, repo and tag", () => {
      const ref = parseOciReference("localhost:5000/product/1/portrait:latest");
      expect(ref.registry).toBe("localhost:5000");
      expect(ref.repository).toBe("product/1/portrait");
      expect(ref.tag).toBe("latest");
      expect(ref.digest).toBeUndefined();
      expect(formatOciReference(ref)).toBe("localhost:5000/product/1/portrait:latest");
    });

    test("parses reference without host using fallback registry", () => {
      const ref = parseOciReference("product/1/portrait:2020", "localhost:5000");
      expect(ref.registry).toBe("localhost:5000");
      expect(ref.repository).toBe("product/1/portrait");
      expect(ref.tag).toBe("2020");
    });

    test("defaults tag to latest when missing", () => {
      const ref = parseOciReference("product/1/portrait", "localhost:5000");
      expect(ref.tag).toBe("latest");
    });

    test("parses digest reference @sha256:...", () => {
      const ref = parseOciReference("localhost:5000/media@sha256:1234567890abcdef");
      expect(ref.digest).toBe("sha256:1234567890abcdef");
      expect(ref.tag).toBeUndefined();
    });

    test("extracts subpath from hash fragment (#filename)", () => {
      const ref = parseOciReference("localhost:5000/product/1/gallery:v1#photo.png");
      expect(ref.repository).toBe("product/1/gallery");
      expect(ref.tag).toBe("v1");
      expect(ref.subpath).toBe("photo.png");
      expect(formatOciReference(ref)).toBe("localhost:5000/product/1/gallery:v1#photo.png");
    });
  });

  describe("AuthManager & Challenge Negotiation", () => {
    test("parses Basic and Bearer challenges correctly", () => {
      const basic = parseWwwAuthenticate('Basic realm="Registry Realm"');
      expect(basic.scheme).toBe("basic");
      expect(basic.realm).toBe("Registry Realm");

      const bearer = parseWwwAuthenticate(
        'Bearer realm="https://auth.example.com/token",service="registry",scope="repository:catalog:pull"'
      );
      expect(bearer.scheme).toBe("bearer");
      expect(bearer.realm).toBe("https://auth.example.com/token");
      expect(bearer.service).toBe("registry");
      expect(bearer.scope).toBe("repository:catalog:pull");
    });

    test("handles Basic auth challenge", async () => {
      const auth = new AuthManager({ username: "dev", password: "secret" });
      const header = await auth.handleChallenge('Basic realm="Test"');
      expect(header).toBe(`Basic ${btoa("dev:secret")}`);
    });

    test("returns static Bearer token if provided", async () => {
      const auth = new AuthManager({ token: "my-jwt-token" });
      const header = await auth.handleChallenge('Bearer realm="https://auth.test/token"');
      expect(header).toBe("Bearer my-jwt-token");
    });
  });

  describe("Mock OCI Registry Interaction & createOrasStorage", () => {
    let server: ReturnType<typeof Bun.serve>;
    let registryHost: string;
    const sampleBlobBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
    const sampleDigest = "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

    beforeAll(() => {
      server = Bun.serve({
        port: 0,
        async fetch(req) {
          const url = new URL(req.url);

          // Ping /v2/
          if (url.pathname === "/v2/" || url.pathname === "/v2") {
            return new Response("{}", { status: 200, headers: { "Docker-Distribution-Api-Version": "registry/2.0" } });
          }

          // Manifest: GET /v2/<repo>/manifests/<tagOrDigest>
          if (url.pathname.includes("/manifests/")) {
            const manifest = {
              schemaVersion: 2,
              mediaType: "application/vnd.oci.image.manifest.v1+json",
              config: {
                mediaType: "application/vnd.oci.empty.v1+json",
                digest: "sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
                size: 2,
              },
              layers: [
                {
                  mediaType: "image/png",
                  digest: sampleDigest,
                  size: sampleBlobBytes.length,
                  annotations: {
                    "org.opencontainers.image.title": "portrait.png",
                  },
                },
              ],
            };
            return new Response(JSON.stringify(manifest), {
              status: 200,
              headers: { "Content-Type": "application/vnd.oci.image.manifest.v1+json" },
            });
          }

          // Blob: GET /v2/<repo>/blobs/<digest>
          if (url.pathname.includes("/blobs/")) {
            if (req.method === "HEAD") {
              return new Response(null, { status: 200 });
            }
            return new Response(sampleBlobBytes, {
              status: 200,
              headers: {
                "Content-Type": "image/png",
                "Content-Length": sampleBlobBytes.length.toString(),
                "Docker-Content-Digest": sampleDigest,
              },
            });
          }

          return new Response("Not Found", { status: 404 });
        },
      });

      registryHost = `localhost:${server.port}`;
    });

    afterAll(() => {
      server.stop();
    });

    test("OrasClient pings registry and fetches artifact stream", async () => {
      const client = new OrasClient({
        hostname: registryHost,
        insecure: true,
      });

      const isAlive = await client.ping();
      expect(isAlive).toBe(true);

      const artifact = await client.getArtifactStream("product/1/portrait:latest");
      expect(artifact.digest).toBe(sampleDigest);
      expect(artifact.mediaType).toBe("image/png");

      const bytes = await new Response(artifact.stream).bytes();
      expect(bytes).toEqual(sampleBlobBytes);
    });

    test("createOrasStorage adapter resolves key and returns StorageAssetResult with immutable ETag", async () => {
      const loader = createOrasStorage({
        hostname: registryHost,
        insecure: true,
      });

      // Fetch with key
      const result = await loader("product/1/portrait");
      expect(result).toBeDefined();
      if ("bytes" in result) {
        expect(result.bytes).toEqual(sampleBlobBytes);
        expect(result.etag).toBe(sampleDigest);
        expect(result.contentType).toBe("image/png");
      }
    });

    test("createOrasStorage applies optional prefix", async () => {
      const loader = createOrasStorage({
        hostname: registryHost,
        prefix: "catalog",
        insecure: true,
      });

      const result = await loader("1/portrait:2020");
      if ("bytes" in result) {
        expect(result.bytes).toEqual(sampleBlobBytes);
        expect(result.etag).toBe(sampleDigest);
      }
    });
  });
});
