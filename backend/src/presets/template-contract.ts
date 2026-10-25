import { createHash } from 'node:crypto';
import { z } from 'zod';
import { PropType } from '../prop/models/main';
import type { ReleaseSnapshot } from './releases';

function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value !== null && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
            .map(([key, child]) => [key, canonical(child)]));
    }
    return value;
}

export function canonicalChecksum(value: unknown): string {
    const json = JSON.stringify(canonical(value));
    if (json === undefined) throw new Error('Expected JSON value');
    return createHash('sha256').update(json, 'utf8').digest('hex');
}

const identifier = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
const key = z.string().regex(/^[a-z][a-zA-Z0-9]*(?:-[a-zA-Z0-9]+)*$/);
const nonempty = z.string().min(1);
const checksum = z.string().regex(/^[a-f0-9]{64}$/);
const route = z.string().regex(/^\/(?:[a-z0-9-]+|:[a-z][a-z0-9]*)(?:\/(?:[a-z0-9-]+|:[a-z][a-z0-9]*))*$|^\/$/)
    .refine((path) => path === '/products/:slug' ||
        !/^(?:api|preview|presets|products|_nuxt|__nuxt|sitemap\.xml|robots\.txt)$/.test(path.split('/')[1]),
    'Reserved route');
const assetPath = z.string().regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/[a-zA-Z0-9_-]+\.(?:png|jpe?g|webp|gif|avif)$/);

function unique(values: string[]): boolean { return new Set(values).size === values.length; }

function patternMatches(pattern: string, path: string): boolean {
    const lhs = pattern.split('/');
    const rhs = path.split('/');
    return lhs.length === rhs.length && lhs.every((part, index) => part === rhs[index] || part.startsWith(':'));
}

const field = z.object({
    key, label: nonempty, type: z.nativeEnum(PropType), required: z.boolean(), array: z.boolean(),
    referenceModel: key.optional(),
}).strict();
const manifestSchema = z.object({
    schemaVersion: z.literal(1), id: identifier, version: z.string().regex(/^\d+\.\d+\.\d+$/),
    name: nonempty, description: z.string(),
    compatibility: z.object({ cmsSchema: z.literal(1), releaseSchema: z.literal(1) }).strict(),
    models: z.array(z.object({
        key, label: nonempty, description: z.string(), singleEntry: z.boolean(), fields: z.array(field).min(1),
    }).strict()).min(1),
    pages: z.array(z.object({ key, title: nonempty, path: route, modelKey: key, layout: nonempty }).strict()).min(1),
    assets: z.array(z.object({ path: assetPath, checksum, mimeType: z.enum([
        'image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/avif',
    ]) }).strict().refine((asset) => {
        const mimeByExtension: Record<string, string> = {
            png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
            webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
        };
        return mimeByExtension[asset.path.split('.').pop() || ''] === asset.mimeType;
    }, 'Asset extension and MIME type do not match')),
}).strict().superRefine((manifest, ctx) => {
    const models = new Set(manifest.models.map((model) => model.key));
    const issue = (message: string) => ctx.addIssue({ code: z.ZodIssueCode.custom, message });
    if (!unique([...models]) || models.size !== manifest.models.length) issue('Duplicate model key');
    for (const model of manifest.models) {
        if (!unique(model.fields.map((item) => item.key))) issue(`Duplicate field key: ${model.key}`);
        for (const item of model.fields) {
            if (item.type === PropType.ENTRY_POINTER ? !item.referenceModel || !models.has(item.referenceModel) : item.referenceModel !== undefined) {
                issue(`Invalid field reference: ${model.key}.${item.key}`);
            }
        }
    }
    if (!unique(manifest.pages.map((page) => page.key))) issue('Duplicate page key');
    for (let i = 0; i < manifest.pages.length; i++) {
        for (let j = i + 1; j < manifest.pages.length; j++) {
            const first = manifest.pages[i].path;
            const second = manifest.pages[j].path;
            if (patternMatches(first, second) || patternMatches(second, first)) issue('Duplicate page path');
        }
    }
    if (!unique(manifest.assets.map((asset) => asset.path))) issue('Duplicate asset path');
    for (const page of manifest.pages) if (!models.has(page.modelKey)) issue(`Unknown page model: ${page.modelKey}`);
});
const recordSchema = z.object({
    schemaVersion: z.literal(1), id: identifier, version: z.string().regex(/^\d+\.\d+\.\d+$/),
    manifestChecksum: checksum, imageDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/), status: z.literal('available'),
}).strict();
const artifactSchema = z.object({ record: recordSchema, manifest: manifestSchema }).strict().superRefine((value, ctx) => {
    if (value.record.id !== value.manifest.id || value.record.version !== value.manifest.version ||
        value.record.manifestChecksum !== canonicalChecksum(value.manifest)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Record does not match manifest' });
    }
});

export type TemplateArtifact = z.infer<typeof artifactSchema>;
export function parseTemplateArtifact(value: unknown): TemplateArtifact {
    return artifactSchema.parse(value);
}

const link = z.object({ label: z.string(), path: z.string() }).strict();
const image = z.object({ title: z.string(), image: z.string() });
const preset = z.object({
    id: z.string(), version: z.string(), name: z.string(), description: z.string(),
    theme: z.object({ background: z.string(), foreground: z.string(), accent: z.string(), muted: z.string(), font: z.string() }),
    demo: z.object({
        brand: z.string(), contactEmail: z.string().optional(),
        hero: image.extend({ subtitle: z.string() }),
        product: image.extend({ price: z.string(), description: z.string() }),
        collection: image.extend({ description: z.string() }),
        page: image.extend({ body: z.string() }),
    }),
    showcase: z.object({
        eyebrow: z.string(), heroLabel: z.string(), stats: z.array(z.object({ value: z.string(), label: z.string() })),
        products: z.array(image.extend({ price: z.string(), description: z.string() })),
        solutions: z.array(z.object({ title: z.string(), description: z.string(), image: z.string() })),
        faq: z.array(z.object({ question: z.string(), answer: z.string() })),
    }).optional(),
});
const snapshotSchema = z.object({
    schemaVersion: z.literal(1), workspaceId: nonempty, siteId: nonempty, language: nonempty,
    pages: z.array(z.object({
        path: z.string(), pageKey: z.string(), entryId: z.string(),
        content: z.object({
            kind: z.literal('preset-page'), view: z.enum(['home', 'collection', 'product', 'page']), preset,
            sections: z.array(z.string()), seo: z.object({ title: z.string(), description: z.string() }),
            items: z.array(link.extend({ image: z.string(), description: z.string(), price: z.string() })).optional(),
        }),
    })),
    navigation: z.array(link), redirects: z.array(z.object({ from: z.string(), to: z.string() })),
}).strict();
const envelopeSchema = z.object({
    schemaVersion: z.literal(1), workspaceId: nonempty, siteId: nonempty, releaseId: nonempty,
    checksum, snapshot: snapshotSchema,
}).strict().superRefine((value, ctx) => {
    if (value.workspaceId !== value.snapshot.workspaceId || value.siteId !== value.snapshot.siteId ||
        value.checksum !== canonicalChecksum(value.snapshot)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Envelope does not match Release snapshot' });
    }
});

export type SnapshotEnvelope = Omit<z.infer<typeof envelopeSchema>, 'snapshot'> & { snapshot: ReleaseSnapshot };
export function parseSnapshotEnvelope(value: unknown): SnapshotEnvelope {
    const parsed = envelopeSchema.parse(value);
    if (parsed.checksum !== canonicalChecksum((value as { snapshot: unknown }).snapshot)) {
        throw new Error('Envelope does not match raw Release snapshot');
    }
    return { ...parsed, snapshot: parsed.snapshot as ReleaseSnapshot };
}
