import { PropType, type Prop, type PropValue } from '../prop/models/main';
import { propsValueCheck } from '../prop/values';
import type { Template } from '../template/models/main';
import type { Widget } from '../widget/models/main';
import type { Group } from '../group/models/main';
import type { Media } from '../media/models/main';
import {
    EntryContentNodeType,
    EntryContentNodeMarkerType,
} from '../entry/models/content';

export interface StructuredResources {
    widgets: Widget[];
    groups: Group[];
    templates: Template[];
    medias: Media[];
}
const object = (value: unknown): value is Record<string, any> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Shape and recursion limits complement propsValueCheck's existing field rules.
 * Resources come from authorized repositories; site provenance is checked by the
 * shared semantic Entry validator before persistence. */
export function validateStructuredFields(
    template: Pick<Template, 'props'>,
    props: PropValue[],
    resources: StructuredResources,
): void {
    // Check recursive shapes first: the historical validator assumes valid widget/group envelopes.
    validateValues(template.props, props, resources, 'studio.fields', 0);
    const check = propsValueCheck(
        template.props,
        props,
        'studio.fields',
        resources.widgets,
        resources.groups,
        resources.templates,
        resources.medias,
    );
    if (check instanceof Error) throw check;
}
function validateValues(
    definitions: Prop[],
    values: PropValue[],
    resources: StructuredResources,
    path: string,
    depth: number,
): void {
    if (depth > 32) throw new Error(`${path}: maximum depth exceeded`);
    if (
        !Array.isArray(values) ||
        values.length !== definitions.length ||
        values.some(
            (value) => !object(value) || typeof value.id !== 'string',
        ) ||
        new Set(values.map((value) => value.id)).size !== values.length
    )
        throw new Error(`${path}: No value found or invalid duplicate fields`);
    for (const value of values) {
        const prop = definitions.find((item) => item.id === value.id);
        const at = `${path}.${prop?.name || value.id}`;
        if (!prop) throw new Error(`${at}: unknown field`);
        const data: unknown = value.data;
        if (
            prop.type === PropType.GROUP_POINTER ||
            prop.type === PropType.WIDGET
        ) {
            if (!object(data)) throw new Error(`${at}: invalid structure`);
            if (prop.type === PropType.WIDGET) {
                const widget = resources.widgets.find(
                    (item) => item._id === data._id,
                );
                if (!widget || prop.data.propWidget?._id !== data._id)
                    throw new Error(`${at}: invalid widget`);
                validateValues(
                    widget.props,
                    data.props,
                    resources,
                    at,
                    depth + 1,
                );
            } else {
                const group = resources.groups.find(
                    (item) => item._id === data._id,
                );
                if (
                    !group ||
                    prop.data.propGroupPointer?._id !== data._id ||
                    !Array.isArray(data.items)
                )
                    throw new Error(`${at}: invalid group`);
                for (const item of data.items) {
                    if (!object(item))
                        throw new Error(`${at}: invalid group item`);
                    validateValues(
                        group.props,
                        item.props,
                        resources,
                        at,
                        depth + 1,
                    );
                }
            }
        } else {
            if (!Array.isArray(data))
                throw new Error(`${at}: invalid field array`);
            if (prop.type === PropType.RICH_TEXT) {
                if (
                    prop.required &&
                    (!data.length ||
                        data.some(
                            (item) => !object(item) || !item.nodes?.length,
                        ))
                )
                    throw new Error(`${at}: content is required`);
                for (const item of data) {
                    if (!object(item))
                        throw new Error(`${at}: invalid rich content`);
                    validateStructuredNodes(
                        item.nodes,
                        resources,
                        at,
                        depth + 1,
                    );
                }
            }
            if (prop.type === PropType.MEDIA)
                for (const item of data) {
                    if (
                        !object(item) ||
                        (item._id &&
                            !resources.medias.some(
                                (media) => media._id === item._id,
                            ))
                    )
                        throw new Error(
                            `${at}: media not found or not permitted`,
                        );
                }
            if (
                prop.type === PropType.NUMBER &&
                data.some(
                    (item) =>
                        typeof item !== 'number' || !Number.isFinite(item),
                )
            )
                throw new Error(`${at}: invalid number`);
            if (
                prop.type === PropType.ENUMERATION &&
                data.some(
                    (item) =>
                        !prop.data.propEnum?.items.includes(item as string),
                )
            )
                throw new Error(`${at}: invalid option`);
        }
    }
}
export function validateStructuredNodes(
    nodes: unknown,
    resources: StructuredResources,
    path = 'studio.content',
    depth = 0,
    parent = 'doc',
): void {
    if (depth > 32) throw new Error(`${path}: maximum depth exceeded`);
    if (!Array.isArray(nodes) || nodes.length > 10000)
        throw new Error(`${path}: invalid nodes`);
    const block = [
        'paragraph',
        'heading',
        'bulletList',
        'orderedList',
        'codeBlock',
        'horizontalRule',
        'widget',
    ];
    const allowed =
        parent === 'paragraph' || parent === 'heading'
            ? ['text', 'hardBreak']
            : parent === 'codeBlock'
              ? ['text']
              : parent === 'bulletList' || parent === 'orderedList'
                ? ['listItem']
                : block;
    if ((parent === 'bulletList' || parent === 'orderedList') && !nodes.length)
        throw new Error(`${path}: list requires items`);
    if (parent === 'listItem' && nodes[0]?.type !== 'paragraph')
        throw new Error(`${path}: list item requires a leading paragraph`);
    for (const [index, node] of nodes.entries()) {
        const nodePath = `${path}.${index}`;
        if (!allowed.includes(node?.type))
            throw new Error(`${nodePath}: invalid child of ${parent}`);
        if (
            !object(node) ||
            !Object.values(EntryContentNodeType).includes(node.type)
        )
            throw new Error(`${nodePath}: invalid node type`);
        if (
            node.type === 'horizontalRule' &&
            (node.text !== undefined ||
                node.content !== undefined ||
                node.marks !== undefined)
        )
            throw new Error(`${nodePath}: invalid horizontal rule`);
        if (
            (node.text !== undefined && typeof node.text !== 'string') ||
            (node.type === 'text' &&
                (typeof node.text !== 'string' || !node.text.length)) ||
            (node.type !== 'text' && node.text !== undefined)
        )
            throw new Error(`${nodePath}: invalid text`);
        if (
            node.type === 'heading' &&
            (!object(node.attrs) ||
                !Number.isInteger(node.attrs.level) ||
                node.attrs.level < 1 ||
                node.attrs.level > 6)
        )
            throw new Error(`${nodePath}: invalid heading`);
        if (
            ['text', 'hardBreak', 'widget'].includes(node.type) &&
            node.content !== undefined
        )
            throw new Error(`${nodePath}: leaf cannot contain children`);
        if (node.marks !== undefined) {
            if (!Array.isArray(node.marks))
                throw new Error(`${nodePath}: invalid marks`);
            if (
                node.marks.length &&
                (!['text', 'hardBreak'].includes(node.type) ||
                    parent === 'codeBlock')
            )
                throw new Error(`${nodePath}: marks are not allowed here`);
            if (
                new Set(node.marks.map((mark: any) => mark?.type)).size !==
                node.marks.length
            )
                throw new Error(`${nodePath}: duplicate marks`);
            for (const mark of node.marks) {
                if (
                    !object(mark) ||
                    !Object.values(EntryContentNodeMarkerType).includes(
                        mark.type,
                    )
                )
                    throw new Error(`${nodePath}: invalid mark`);
                if (
                    mark.type === 'link' &&
                    (!object(mark.attrs) ||
                        typeof mark.attrs.href !== 'string' ||
                        !/^(https?:\/\/|mailto:|tel:|\/(?!\/)|#|entry:[^:]+:entry$|media:[^:]+:media$)/i.test(
                            mark.attrs.href,
                        ) ||
                        mark.attrs.href.includes('\\') ||
                        (mark.attrs.target !== undefined &&
                            mark.attrs.target !== null &&
                            typeof mark.attrs.target !== 'string') ||
                        (/^entry:/i.test(mark.attrs.href) &&
                            !/^entry:[^:]+@\*_[^:]+:entry$/.test(
                                mark.attrs.href,
                            )) ||
                        (/^media:/i.test(mark.attrs.href) &&
                            !/^media:[^:]+@\*_@\*_:media$/.test(
                                mark.attrs.href,
                            )))
                )
                    throw new Error(`${nodePath}: invalid link`);
            }
        }
        if (node.type === 'widget') {
            const data = node.attrs?.data;
            const widget =
                object(data) &&
                resources.widgets.find((item) => item._id === data._id);
            if (!widget)
                throw new Error(
                    `${nodePath}: widget not found or not permitted`,
                );
            validateValues(
                widget.props,
                data.props,
                resources,
                nodePath,
                depth + 1,
            );
            const invalid = propsValueCheck(
                widget.props,
                data.props,
                nodePath,
                resources.widgets,
                resources.groups,
                resources.templates,
                resources.medias,
            );
            if (invalid) throw invalid;
        }
        if (
            !['text', 'hardBreak', 'widget', 'horizontalRule'].includes(
                node.type,
            )
        )
            validateStructuredNodes(
                node.content ?? [],
                resources,
                `${nodePath}.content`,
                depth + 1,
                node.type,
            );
    }
}
