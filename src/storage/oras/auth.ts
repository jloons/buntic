import type { AuthCredentials, BasicAuth, TokenAuth } from "./types.ts";

export interface ParsedChallenge {
  scheme: "basic" | "bearer" | string;
  realm?: string;
  service?: string;
  scope?: string;
  params: Record<string, string>;
}

/**
 * Parses a `Www-Authenticate` header string into its scheme and parameters.
 * Example inputs:
 * - Basic realm="Registry Realm"
 * - Bearer realm="https://auth.example.com/token",service="registry",scope="repository:foo:pull"
 */
export function parseWwwAuthenticate(header: string): ParsedChallenge {
  const trimmed = header.trim();
  const spaceIdx = trimmed.indexOf(" ");

  if (spaceIdx === -1) {
    return {
      scheme: trimmed.toLowerCase(),
      params: {},
    };
  }

  const scheme = trimmed.slice(0, spaceIdx).toLowerCase();
  const paramsStr = trimmed.slice(spaceIdx + 1);

  const params: Record<string, string> = {};
  const regex = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|([^,]*))/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(paramsStr)) !== null) {
    const key = match[1].toLowerCase();
    const val = match[2] !== undefined ? match[2] : match[3];
    params[key] = val;
  }

  return {
    scheme,
    realm: params.realm,
    service: params.service,
    scope: params.scope,
    params,
  };
}

/**
 * Manages authentication challenges, token caching and Authorization headers.
 */
export class AuthManager {
  private credentials?: AuthCredentials;
  private tokenCache: Map<string, string> = new Map();

  constructor(credentials?: AuthCredentials) {
    this.credentials = credentials;
  }

  /**
   * Set or update authentication credentials.
   */
  setCredentials(credentials?: AuthCredentials): void {
    this.credentials = credentials;
    this.tokenCache.clear();
  }

  /**
   * Generates a direct Basic auth header if username/password are available.
   */
  getBasicHeader(): string | undefined {
    if (!this.credentials || !("username" in this.credentials)) {
      return undefined;
    }
    const { username, password } = this.credentials as BasicAuth;
    return `Basic ${btoa(`${username}:${password}`)}`;
  }

  /**
   * Generates initial Authorization header if known ahead of time.
   */
  getInitialAuthHeader(): string | undefined {
    if (!this.credentials) return undefined;
    if ("token" in this.credentials) {
      return `Bearer ${(this.credentials as TokenAuth).token}`;
    }
    return this.getBasicHeader();
  }

  /**
   * Handles a 401 challenge from a Www-Authenticate header, obtaining a token if needed.
   * Returns the Authorization header value to retry with, or undefined if auth cannot be resolved.
   */
  async handleChallenge(
    wwwAuthHeader: string,
    requestedScope?: string
  ): Promise<string | undefined> {
    const challenge = parseWwwAuthenticate(wwwAuthHeader);

    if (challenge.scheme === "basic") {
      return this.getBasicHeader();
    }

    if (challenge.scheme === "bearer") {
      // Check if user already gave a static Bearer token
      if (this.credentials && "token" in this.credentials) {
        return `Bearer ${(this.credentials as TokenAuth).token}`;
      }

      if (!challenge.realm) {
        return undefined;
      }

      // Check cache
      const scope = requestedScope || challenge.scope || "";
      const cacheKey = `${challenge.realm}|${challenge.service || ""}|${scope}`;
      const cached = this.tokenCache.get(cacheKey);
      if (cached) {
        return `Bearer ${cached}`;
      }

      // Fetch dynamic bearer token from realm
      const token = await this.requestBearerToken(challenge, scope);
      if (token) {
        this.tokenCache.set(cacheKey, token);
        return `Bearer ${token}`;
      }
    }

    return undefined;
  }

  private async requestBearerToken(
    challenge: ParsedChallenge,
    scope: string
  ): Promise<string | undefined> {
    const url = new URL(challenge.realm!);
    if (challenge.service) {
      url.searchParams.set("service", challenge.service);
    }
    if (scope) {
      url.searchParams.set("scope", scope);
    }

    const headers: Record<string, string> = {
      Accept: "application/json",
    };

    const basicHeader = this.getBasicHeader();
    if (basicHeader) {
      headers["Authorization"] = basicHeader;
    }

    try {
      const res = await fetch(url.toString(), { headers });
      if (!res.ok) {
        return undefined;
      }
      const data = (await res.json()) as { token?: string; access_token?: string };
      return data.token || data.access_token;
    } catch {
      return undefined;
    }
  }
}

/**
 * Searches and loads stored Docker / Podman credentials from ~/.docker/config.json
 * or ~/.config/containers/auth.json for a given registry hostname.
 */
export async function loadStoredCredentials(
  registryHostname?: string
): Promise<AuthCredentials | undefined> {
  const home = process.env.HOME || "";
  const configPaths = [
    `${home}/.docker/config.json`,
    `${process.env.XDG_CONFIG_HOME || `${home}/.config`}/containers/auth.json`,
    `${home}/.dockercfg`,
  ];

  for (const configPath of configPaths) {
    try {
      const file = Bun.file(configPath);
      if (!(await file.exists())) continue;
      const json = await file.json();
      const auths = json.auths || json;

      if (!registryHostname) {
        const firstKey = Object.keys(auths)[0];
        if (firstKey && auths[firstKey]) {
          const cred = parseAuthEntry(auths[firstKey]);
          if (cred) return cred;
        }
      } else {
        const cleanHost = registryHostname
          .replace(/^https?:\/\//i, "")
          .replace(/\/+$/, "");
        for (const [key, value] of Object.entries(auths)) {
          const keyClean = key
            .replace(/^https?:\/\//i, "")
            .replace(/\/+$/, "");
          if (keyClean === cleanHost && value && typeof value === "object") {
            const cred = parseAuthEntry(value as { auth?: string; identitytoken?: string });
            if (cred) return cred;
          }
        }
      }
    } catch {
      // Ignore missing or unreadable config
    }
  }

  return undefined;
}

function parseAuthEntry(entry: {
  auth?: string;
  identitytoken?: string;
}): AuthCredentials | undefined {
  if (entry.identitytoken) {
    return { token: entry.identitytoken };
  }
  if (entry.auth) {
    try {
      const decoded = atob(entry.auth);
      const colon = decoded.indexOf(":");
      if (colon !== -1) {
        return {
          username: decoded.slice(0, colon),
          password: decoded.slice(colon + 1),
        };
      }
    } catch {
      return undefined;
    }
  }
  return undefined;
}
