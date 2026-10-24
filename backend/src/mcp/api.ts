import type { FastifyInstance } from 'fastify';

export type McpApiMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';
export type McpApiOptions = { headers?: Record<string, string> };

export function createMcpApi(
    fastify: FastifyInstance,
    authorization: string,
    selectors: Record<string, string>,
) {
    return async function api<T>(
        method: McpApiMethod,
        url: string,
        payload?: unknown,
        options: McpApiOptions = {},
    ): Promise<T> {
        const response: any = await fastify.inject({
            method,
            url,
            headers: { authorization, ...selectors, ...options.headers },
            payload: payload as any,
        });
        let data: any;
        try {
            data = response.json();
        } catch {
            const contentType =
                response.headers['content-type'] || 'application/octet-stream';
            data = {
                contentType,
                base64: Buffer.from(response.rawPayload).toString('base64'),
            };
        }
        if (response.statusCode < 200 || response.statusCode >= 300) {
            throw new Error(
                data?.message || `BCMS API returned ${response.statusCode}`,
            );
        }
        return data as T;
    };
}
