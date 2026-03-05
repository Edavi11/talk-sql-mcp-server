/**
 * Constants for SQL MCP Server
 */

export const CHARACTER_LIMIT = 25000;

export const MAX_QUERY_LENGTH = 100000; // Maximum SQL query length

export const DEFAULT_LIMIT = 100;

export const MAX_LIMIT = 1000;

export const DEFAULT_OFFSET = 0;

/**
 * Gets the connection string from parameters or environment variable
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
