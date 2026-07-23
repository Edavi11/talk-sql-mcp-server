/**
 * Constants for SQL MCP Server
 */

import * as fs from "fs";
import { NamedConnectionsArraySchema } from "./schemas/connection.js";
import { openSshTunnel } from "./services/ssh-tunnel.js";
import type { NamedConnection, ResolvedConnection } from "./types.js";

export const CHARACTER_LIMIT = 25000;

export const MAX_QUERY_LENGTH = 100000; // Maximum SQL query length

export const DEFAULT_LIMIT = 100;

export const MAX_LIMIT = 1000;

export const DEFAULT_OFFSET = 0;

/**
 * Whether the server is running in read-only mode (TALK_SQL_READONLY).
 * When true, any tool that can modify the database is blocked.
 */
export function isReadOnlyMode(): boolean {
  const raw = process.env.TALK_SQL_READONLY;
  if (!raw) return false;
  return ["true", "1", "yes"].includes(raw.trim().toLowerCase());
}

// Cache for named connections loaded from config file
let namedConnectionsCache: NamedConnection[] | null | undefined = undefined;

/**
 * Loads and validates named connections from the config file specified by TALK_SQL_CONFIG.
 * Returns null if TALK_SQL_CONFIG is not set.
 * Caches the result for the lifetime of the process.
 */
export function getNamedConnections(): NamedConnection[] | null {
  if (namedConnectionsCache !== undefined) return namedConnectionsCache;

  const configPath = process.env.TALK_SQL_CONFIG;
  if (!configPath || configPath.trim().length === 0) {
    namedConnectionsCache = null;
    return null;
  }

  if (!fs.existsSync(configPath)) {
    throw new Error(
      `Config file not found: ${configPath} (specified in TALK_SQL_CONFIG)`
    );
  }

  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf-8");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to read config file ${configPath}: ${msg}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      `Config file ${configPath} is not valid JSON. Expected a JSON array of connection objects.`
    );
  }

  const result = NamedConnectionsArraySchema.safeParse(parsed);
  if (!result.success) {
    const first = result.error.errors[0];
    throw new Error(
      `Invalid config file ${configPath}: ${first.path.join(".")} — ${first.message}`
    );
  }

  // Validate unique names
  const names = result.data.map(c => c.name);
  const duplicates = names.filter((n, i) => names.indexOf(n) !== i);
  if (duplicates.length > 0) {
    throw new Error(
      `Config file ${configPath} has duplicate connection names: ${[...new Set(duplicates)].join(", ")}`
    );
  }

  namedConnectionsCache = result.data as NamedConnection[];
  return namedConnectionsCache;
}

/**
 * Rewrites a connection string's host and port to point to a local SSH tunnel port.
 */
function rewriteConnectionStringForTunnel(connectionString: string, localPort: number): string {
  const url = new URL(connectionString);
  url.hostname = "127.0.0.1";
  url.port = String(localPort);
  return url.toString();
}

/**
 * Resolves a connection from connection_name or connection_string params.
 * Priority:
 * 1. connection_name → look up in config file
 * 2. connection_string → use literal string
 * 3. Single entry in config file → auto-select
 * 4. SQL_CONNECTION_STRING env var → legacy fallback
 */
export async function resolveConnection(params: {
  connection_string?: string;
  connection_name?: string;
}): Promise<ResolvedConnection> {
  const noopCleanup = async () => {};

  // 1. connection_name takes highest priority
  if (params.connection_name && params.connection_name.trim().length > 0) {
    const connections = getNamedConnections();
    if (!connections) {
      throw new Error(
        `connection_name '${params.connection_name}' was specified but TALK_SQL_CONFIG is not configured. ` +
        `Set TALK_SQL_CONFIG to the path of your connections config file.`
      );
    }

    const entry = connections.find(c => c.name === params.connection_name);
    if (!entry) {
      const available = connections.map(c => c.name).join(", ");
      throw new Error(
        `Connection '${params.connection_name}' not found. Available connections: ${available}`
      );
    }

    if (entry.ssh) {
      // Parse remote host/port from the connection string
      const url = new URL(entry.connectionString);
      const remoteHost = url.hostname;
      const remotePort = url.port ? parseInt(url.port) : getDefaultPort(url.protocol);

      const tunnel = await openSshTunnel(entry.ssh, remoteHost, remotePort);
      const rewritten = rewriteConnectionStringForTunnel(entry.connectionString, tunnel.localPort);
      return { connectionString: rewritten, cleanup: tunnel.close };
    }

    return { connectionString: entry.connectionString, cleanup: noopCleanup };
  }

  // 2. Explicit connection_string
  if (params.connection_string && params.connection_string.trim().length > 0) {
    return { connectionString: params.connection_string, cleanup: noopCleanup };
  }

  // 3. Single entry in config file — auto-select
  const connections = getNamedConnections();
  if (connections && connections.length === 1) {
    const entry = connections[0];
    if (entry.ssh) {
      const url = new URL(entry.connectionString);
      const remoteHost = url.hostname;
      const remotePort = url.port ? parseInt(url.port) : getDefaultPort(url.protocol);
      const tunnel = await openSshTunnel(entry.ssh, remoteHost, remotePort);
      const rewritten = rewriteConnectionStringForTunnel(entry.connectionString, tunnel.localPort);
      return { connectionString: rewritten, cleanup: tunnel.close };
    }
    return { connectionString: entry.connectionString, cleanup: noopCleanup };
  }

  // 4. Legacy SQL_CONNECTION_STRING fallback
  const envConnectionString = process.env.SQL_CONNECTION_STRING;
  if (envConnectionString && envConnectionString.trim().length > 0) {
    return { connectionString: envConnectionString, cleanup: noopCleanup };
  }

  throw new Error(
    "No connection configured. Either:\n" +
    "  - Set TALK_SQL_CONFIG to a config file path and use connection_name parameter\n" +
    "  - Pass connection_string directly\n" +
    "  - Set SQL_CONNECTION_STRING environment variable"
  );
}

function getDefaultPort(protocol: string): number {
  switch (protocol.replace(":", "")) {
    case "postgresql":
    case "postgres": return 5432;
    case "mysql": return 3306;
    case "mssql": return 1433;
    default: return 5432;
  }
}

/**
 * @deprecated Use resolveConnection() instead.
 * Kept for any internal callers during transition.
 */
export function getConnectionString(provided?: string): string {
  if (provided && provided.trim().length > 0) {
    return provided;
  }

  const envConnectionString = process.env.SQL_CONNECTION_STRING;
  if (!envConnectionString || envConnectionString.trim().length === 0) {
    throw new Error(
      "Connection string is required. Either provide it as a parameter or set SQL_CONNECTION_STRING environment variable."
    );
  }

  return envConnectionString;
}
