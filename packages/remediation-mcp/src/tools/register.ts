import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { RemediationConfig } from '../config.js';
import { restartPodInput, restartPodHandler } from './restart-pod.js';
import { rollbackDeploymentInput, rollbackDeploymentHandler } from './rollback-deployment.js';
import { scaleServiceInput, scaleServiceHandler } from './scale-service.js';

function asTextContent(result: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
  };
}

export function registerRemediationTools(server: McpServer, config: RemediationConfig): void {
  server.tool(
    'restartPod',
    'Restart a single service pod. Use when a service has degraded but recent deploys look clean — restart resets in-memory state, leaked resources, and connection pools. Less invasive than a rollback.',
    restartPodInput,
    async (args) => asTextContent(await restartPodHandler(args as z.infer<z.ZodObject<typeof restartPodInput>>, config)),
  );

  server.tool(
    'rollbackDeployment',
    'Roll a service back to its previous successful deployment. Use when a recent deploy correlates with the incident time and metrics regressed only on the new version. Higher impact than a restart but the right tool when a bad deploy is in the wild.',
    rollbackDeploymentInput,
    async (args) =>
      asTextContent(
        await rollbackDeploymentHandler(args as z.infer<z.ZodObject<typeof rollbackDeploymentInput>>, config),
      ),
  );

  server.tool(
    'scaleService',
    'Scale a service up or down by changing its replica count. Use when the incident is load-driven — CPU saturation, request queueing, or autoscaler lag — and the code itself is healthy.',
    scaleServiceInput,
    async (args) =>
      asTextContent(await scaleServiceHandler(args as z.infer<z.ZodObject<typeof scaleServiceInput>>, config)),
  );
}
