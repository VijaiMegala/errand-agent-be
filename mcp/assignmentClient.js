import { MCPClient } from '@mastra/mcp';

export function createAssignmentMcpClient({ url = 'http://127.0.0.1:5002/mcp', accessToken } = {}) {
  const endpoint = new URL(url);
  if (!['http:', 'https:'].includes(endpoint.protocol)) throw new Error('MCP URL must use HTTP or HTTPS');
  if (typeof accessToken !== 'string' || !accessToken.trim()) throw new Error('A signed-in user access token is required for MCP');
  return new MCPClient({
    registerProcessHooks: false,
    servers: {
      assignment: {
        url: endpoint,
        requestInit: { headers: { Authorization: `Bearer ${accessToken}` } },
      },
    },
  });
}
