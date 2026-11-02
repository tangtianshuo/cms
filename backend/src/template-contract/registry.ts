import { validateTemplateContract, type TemplateCompatibility, type TemplateEditorContract, type TemplateRendererContract } from './model';

export interface InstalledTemplateContract {
    id: string;
    version: string;
    manifestChecksum: string;
    sourceCommit: string;
    editor: TemplateEditorContract;
    renderer: TemplateRendererContract;
    compatibility: TemplateCompatibility;
}

export function readTemplateContract(manifest: unknown, record: { id: string; version: string; manifestChecksum: string; sourceCommit: string }): InstalledTemplateContract {
    const contract = validateTemplateContract(manifest, record);
    return { ...record, ...contract };
}
