import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpApiMethod, McpApiOptions } from './api';

export type McpApi = <T>(
    method: McpApiMethod,
    url: string,
    payload?: unknown,
    options?: McpApiOptions,
) => Promise<T>;

type ToolDefinition = {
    name: string;
    description: string;
    method: McpApiMethod;
    path: (input: any) => string;
    inputSchema?: Record<string, z.ZodTypeAny>;
    body?: (input: any) => unknown;
    options?: (input: any) => McpApiOptions;
    request?: (input: any) => { body: unknown; options: McpApiOptions };
    readOnly?: boolean;
    destructive?: boolean;
};

export function registerApiTools(
    server: McpServer,
    api: McpApi,
    definitions: ToolDefinition[],
) {
    for (const definition of definitions) {
        server.registerTool(
            definition.name,
            {
                description: definition.description,
                inputSchema: definition.inputSchema || {},
                annotations: {
                    readOnlyHint:
                        definition.readOnly ?? definition.method === 'GET',
                    ...(definition.readOnly
                        ? {}
                        : { destructiveHint: definition.destructive ?? false }),
                },
            },
            async (input: any) => {
                try {
                    const request = definition.request?.(input);
                    const result = await api(
                        definition.method,
                        definition.path(input),
                        request?.body ?? definition.body?.(input),
                        request?.options ?? definition.options?.(input),
                    );
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text: JSON.stringify(result),
                            },
                        ],
                    };
                } catch (error) {
                    return {
                        content: [
                            {
                                type: 'text' as const,
                                text:
                                    error instanceof Error
                                        ? error.message
                                        : String(error),
                            },
                        ],
                        isError: true,
                    };
                }
            },
        );
    }
}

export const idSchema = z.string().min(1);
