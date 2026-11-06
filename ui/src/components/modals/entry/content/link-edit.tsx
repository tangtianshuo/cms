import { defineComponent, onMounted, ref } from 'vue';
import {
    getModalDefaultProps,
    ModalWrapper,
} from '@bcms/selfhosted-ui/components/modals/_wrapper';
import {
    createRefValidator,
    createValidationItem,
} from '@bcms/selfhosted-ui/util/validation';
import { TextInput } from '@bcms/selfhosted-ui/components/inputs/text';
import { StringUtility } from '@bcms/selfhosted-utils/string-utility';
import { SelectEntryPointer } from '@bcms/selfhosted-ui/components/inputs/select/entry-pointer';
import { MediaSelect } from '@bcms/selfhosted-ui/components/inputs/select/media';
import { useI18n } from 'vue-i18n';

type LinkType = 'url' | 'entry' | 'media';

export const linkSplitChar = '@*_';

import type { ContentMediaSite } from '../../../studio/content-media-context';
export interface ModalEntryContentLindEditInput {
    site?: ContentMediaSite;
    isCurrent?: () => boolean;
    href: string;
}

export interface ModalEntryContentLindEditOutput {
    href: string;
}

export const ModalEntryContentLinkEdit = defineComponent({
    props: getModalDefaultProps<
        ModalEntryContentLindEditInput,
        ModalEntryContentLindEditOutput
    >(),
    setup(props) {
        const { t } = useI18n();
        const sdk = window.bcms.sdk;
        const throwable = window.bcms.throwable;

        const data = ref<ModalEntryContentLindEditInput>({
            href: '',
        });
        const inputs = ref(getInputs('url', {}));
        const inputsValid = createRefValidator(inputs);

        function getInputs(
            type: LinkType,
            info: {
                url?: string;
                entry?: {
                    eid: string;
                    tid: string;
                };
                mediaId?: string;
            },
        ) {
            return {
                type: createValidationItem<LinkType>({
                    value: type,
                }),
                url: createValidationItem({
                    value: info.url || '',
                }),
                entry: createValidationItem({
                    value: info.entry
                        ? info.entry
                        : {
                              eid: '',
                              tid: '',
                          },
                }),
                mediaId: createValidationItem({
                    value: info.mediaId || '',
                }),
            };
        }

        function inputsToLink(): string {
            switch (inputs.value.type.value) {
                case 'url': {
                    return inputs.value.url.value;
                }
                case 'media': {
                    if (inputs.value.mediaId.value) {
                        return `media:${inputs.value.mediaId.value}${linkSplitChar}${linkSplitChar}:media`;
                    }
                    return '';
                }
                case 'entry': {
                    if (inputs.value.entry.value.eid) {
                        return `entry:${inputs.value.entry.value.eid}${linkSplitChar}${inputs.value.entry.value.tid}:entry`;
                    }
                    return '';
                }
            }
        }

        onMounted(() => {
            const handler = props.handler;
            handler._onOpen = (event) => {
                if (event?.data) {
                    data.value = event.data;
                    if (
                        data.value.href.startsWith('entry:') &&
                        data.value.href.endsWith(':entry')
                    ) {
                        const [eid, tid] = StringUtility.textBetween(
                            data.value.href,
                            'entry:',
                            ':entry',
                        ).split(linkSplitChar);
                        inputs.value = getInputs('entry', {
                            entry: {
                                eid,
                                tid,
                            },
                        });
                    } else if (
                        data.value.href.startsWith('media:') &&
                        data.value.href.endsWith(':media')
                    ) {
                        const [mediaId] = StringUtility.textBetween(
                            data.value.href,
                            'media:',
                            ':media',
                        ).split(linkSplitChar);
                        inputs.value = getInputs('media', {
                            mediaId,
                        });
                    } else {
                        inputs.value = getInputs('url', {
                            url: data.value.href,
                        });
                    }
                    // Candidate loading must not reset values after the user starts editing.
                    throwable(async () => {
                        await sdk.entry.getAllLite();
                        await sdk.media.getAll();
                    }).catch((err) => console.error(err));
                }
            };
            handler._onDone = async () => {
                if (data.value.isCurrent && !data.value.isCurrent())
                    return [false, { href: '' }];
                if (!inputsValid()) {
                    return [false, { href: '' }];
                }
                return [true, { href: inputsToLink() }];
            };
            handler._onCancel = async () => {
                return true;
            };
        });

        function getActiveSection(type: LinkType) {
            switch (type) {
                case 'url': {
                    return (
                        <TextInput
                            label={t('modals.link.urlLabel')}
                            value={inputs.value.url.value}
                            placeholder={t('modals.link.urlPlaceholder')}
                            focus
                            onInput={(value) => {
                                inputs.value.url.value = value;
                            }}
                        />
                    );
                }
                case 'entry': {
                    return (
                        <SelectEntryPointer
                            selected={inputs.value.entry.value.eid}
                            error={inputs.value.entry.error}
                            onChange={(entry) => {
                                if (
                                    inputs.value.entry.value.eid === entry._id
                                ) {
                                    inputs.value.entry.value = {
                                        eid: '',
                                        tid: '',
                                    };
                                } else {
                                    inputs.value.entry.value = {
                                        eid: entry._id,
                                        tid: entry.templateId,
                                    };
                                }
                            }}
                        />
                    );
                }
                case 'media': {
                    return (
                        <MediaSelect
                            site={data.value.site}
                            isCurrent={data.value.isCurrent}
                            label={t('modals.link.mediaFile')}
                            mediaId={inputs.value.mediaId.value}
                            error={inputs.value.mediaId.error}
                            onChange={(event) => {
                                inputs.value.mediaId.value =
                                    event?.media._id || '';
                            }}
                        />
                    );
                }
            }
            return '';
        }

        return () => (
            <ModalWrapper
                title={t('modals.link.editTitle')}
                handler={props.handler}
                doneText={t('modals.common.update')}
            >
                <div class={`flex flex-col gap-4`}>
                    <div class="flex flex-col gap-2">
                        <label for="entry-link-type">
                            {t('modals.link.linkType')}
                        </label>
                        <select
                            id="entry-link-type"
                            class="cms-select-trigger"
                            value={inputs.value.type.value}
                            onChange={(event) => {
                                inputs.value.type.value = (
                                    event.target as HTMLSelectElement
                                ).value as LinkType;
                            }}
                        >
                            <option value="url">URL</option>
                            <option value="entry">
                                {t('modals.link.entryPointer')}
                            </option>
                            <option value="media">
                                {t('modals.link.mediaPointer')}
                            </option>
                        </select>
                    </div>
                    {getActiveSection(inputs.value.type.value)}
                </div>
            </ModalWrapper>
        );
    },
});
