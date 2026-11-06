import {
    computed,
    defineComponent,
    onBeforeUnmount,
    onMounted,
    provide,
    ref,
    watch,
    type PropType,
} from 'vue';
import type {
    Prop,
    PropValue,
} from '@bcms/selfhosted-backend/prop/models/main';
import type { Widget } from '@bcms/selfhosted-backend/widget/models/main';
import type { PropValueWidgetData } from '@bcms/selfhosted-backend/prop/models/widget';
import { EntryMetaEditor, entryMetaWidgetRendererKey } from '../entry/meta';
import { entryEditorMetaOnAddPropValue } from '../entry/editor';
import {
    propApplyValueChangeFromPath,
    propPathToArray,
    propValueMoveArrayItem,
    propValueRemoveArrayItem,
} from '../../util/prop';
import { PropValidator } from '../../util/prop-validation';
import {
    entryContentNodesForSave,
    entryPropValuesForSave,
} from '../../util/entry-create';
import type { EntryContentNode } from '@bcms/selfhosted-backend/entry/models/content';
import { structuredValue } from './structured-value';

export const StructuredField = defineComponent({
    name: 'StructuredField',
    props: {
        prop: { type: Object as PropType<Prop>, required: true },
        value: { type: Object as PropType<PropValue>, required: true },
        entryId: { type: String, required: true },
        languageIndex: { type: Number, required: true },
        disabled: { type: Boolean, required: true },
        propIndex: { type: Number, default: 0 },
        propPath: String,
        validator: Object as PropType<PropValidator>,
        onChange: {
            type: Function as PropType<(data: PropValue['data']) => void>,
            required: true,
        },
    },
    setup(props) {
        const sdk = window.bcms.sdk;
        const validator = props.validator || new PropValidator();
        provide(entryMetaWidgetRendererKey, (options) => (
            <StructuredField {...options} disabled={props.disabled} />
        ));
        const path = computed(
            () =>
                props.propPath ||
                `entry.meta.${props.languageIndex}.props.${props.propIndex}`,
        );
        const widget = ref<Widget>();
        let alive = true;
        let generation = 0;
        const context = sdk.context;
        const current = () =>
            alive &&
            !props.disabled &&
            window.bcms.sdk === sdk &&
            sdk.context === context;
        watch(
            () => props.prop.data.propWidget?._id,
            async (id) => {
                const version = ++generation;
                widget.value = undefined;
                if (!id || props.prop.type !== 'WIDGET') return;
                try {
                    const loaded = await sdk.widget.get({ widgetId: id });
                    if (
                        alive &&
                        version === generation &&
                        window.bcms.sdk === sdk &&
                        sdk.context === context
                    )
                        widget.value = loaded;
                } catch {
                    /* Missing schemas preserve the original value read-only. */
                }
            },
            { immediate: true },
        );
        let unregister: (() => void) | undefined;
        onMounted(() => {
            unregister = validator.register(() => {
                if (!props.prop.required) return true;
                if (props.prop.type === 'WIDGET') return Boolean(widget.value);
                if (props.prop.type === 'GROUP_POINTER')
                    return Boolean(
                        sdk.store.group.findById(
                            props.prop.data.propGroupPointer?._id || '',
                        ),
                    );
                return (
                    [
                        'STRING',
                        'NUMBER',
                        'BOOLEAN',
                        'DATE',
                        'ENUMERATION',
                        'MEDIA',
                        'RICH_TEXT',
                        'ENTRY_POINTER',
                    ].includes(props.prop.type) ||
                    Boolean(
                        Array.isArray(props.value.data) &&
                            props.value.data.length,
                    )
                );
            });
        });
        onBeforeUnmount(() => {
            alive = false;
            generation++;
            unregister?.();
        });
        const relative = (input: string) => [
            0,
            ...(input === path.value
                ? []
                : propPathToArray(input.slice(path.value.length + 1))),
        ];
        const change = (mutate: (values: PropValue[]) => void) => {
            if (!current()) return;
            const values = [
                {
                    id: props.value.id,
                    data: structuredValue(props.value.data).data,
                },
            ];
            mutate(values);
            props.onChange(entryPropValuesForSave(values)[0].data);
        };
        return () => {
            if (props.prop.type === 'WIDGET') {
                const data = props.value.data as PropValueWidgetData;
                return (
                    <fieldset
                        disabled={props.disabled}
                        inert={props.disabled ? true : undefined}
                        class="studio-structured-field"
                        data-field={props.prop.name}
                    >
                        <legend>
                            {props.prop.label}
                            {props.prop.required ? ' *' : ''}
                        </legend>
                        {widget.value && data?._id === widget.value._id ? (
                            widget.value.props.map((child, index) => {
                                const value = data.props.find(
                                    (item) => item.id === child.id,
                                );
                                return value ? (
                                    <StructuredField
                                        key={child.id}
                                        prop={child}
                                        value={value}
                                        propIndex={index}
                                        propPath={`${path.value}.data.props.${index}`}
                                        entryId={props.entryId}
                                        languageIndex={props.languageIndex}
                                        disabled={props.disabled}
                                        validator={validator}
                                        onChange={(next) => {
                                            if (!current()) return;
                                            const copy = structuredValue(data)
                                                .data as PropValueWidgetData;
                                            const item = copy.props.find(
                                                (item) => item.id === child.id,
                                            );
                                            if (item) {
                                                item.data = next;
                                                props.onChange(copy);
                                            }
                                        }}
                                    />
                                ) : (
                                    <p role="alert">
                                        {child.label}
                                        缺少可编辑的内容，请联系管理员。
                                    </p>
                                );
                            })
                        ) : (
                            <p class="studio-help">
                                此内容暂时只读，原有内容会完整保留。
                            </p>
                        )}
                    </fieldset>
                );
            }
            const supported = [
                'STRING',
                'NUMBER',
                'BOOLEAN',
                'DATE',
                'ENUMERATION',
                'MEDIA',
                'RICH_TEXT',
                'GROUP_POINTER',
                'ENTRY_POINTER',
            ].includes(props.prop.type);
            if (!supported)
                return (
                    <div class="studio-field">
                        <span>{props.prop.label}</span>
                        <p class="studio-help">
                            此内容暂时只读，原有内容会完整保留。
                        </p>
                    </div>
                );
            const parts = path.value.split('.');
            const index = Number(parts.pop());
            return (
                <fieldset
                    disabled={props.disabled}
                    inert={props.disabled ? true : undefined}
                    class="studio-structured-field"
                    data-field={props.prop.name}
                >
                    <EntryMetaEditor
                        propPath={parts.join('.')}
                        props={[props.prop]}
                        propsIdxOffset={index}
                        values={[props.value]}
                        lngCode={
                            sdk.store.language.items()[props.languageIndex]
                                ?.code || ''
                        }
                        lngIdx={props.languageIndex}
                        entryId={props.entryId}
                        propValidator={validator}
                        onEditProp={(input, value) =>
                            change((values) =>
                                propApplyValueChangeFromPath(
                                    relative(input),
                                    values,
                                    value &&
                                        typeof value === 'object' &&
                                        'nodes' in value
                                        ? {
                                              ...value,
                                              nodes: entryContentNodesForSave(
                                                  (
                                                      value as {
                                                          nodes: EntryContentNode[];
                                                      }
                                                  ).nodes,
                                              ),
                                          }
                                        : value,
                                ),
                            )
                        }
                        onAddValue={async (input, prop) => {
                            if (!current()) return;
                            const source = props.value.data;
                            const values = [
                                {
                                    id: props.value.id,
                                    data: structuredValue(source).data,
                                },
                            ];
                            await entryEditorMetaOnAddPropValue(
                                values,
                                relative(input),
                                prop,
                            );
                            if (current() && props.value.data === source)
                                props.onChange(
                                    entryPropValuesForSave(values)[0].data,
                                );
                        }}
                        onRemoveArrayItem={(input) =>
                            change((values) =>
                                propValueRemoveArrayItem(
                                    relative(input),
                                    values,
                                ),
                            )
                        }
                        onMoveArrayItem={(input, direction) =>
                            change((values) =>
                                propValueMoveArrayItem(
                                    relative(input),
                                    values,
                                    direction,
                                ),
                            )
                        }
                    />
                </fieldset>
            );
        };
    },
});
