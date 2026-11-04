export interface PageSectionOptionSet {
    allowed: string[];
    required: string;
    requiredSections?: string[];
    labels?: Record<string, string>;
    visual?: boolean;
}

export const sectionEditorTypes = [
    'hero-carousel',
    'info-grid',
    'faq',
    'product-gallery',
    'product-information',
    'product-description',
] as const;

export type SectionEditorType = typeof sectionEditorTypes[number];

export function sectionTypesForEditor(options: PageSectionOptionSet | null | undefined): SectionEditorType[] {
    return (options?.allowed || [])
        .filter((type): type is SectionEditorType => (sectionEditorTypes as readonly string[]).includes(type));
}

export function canUseSectionEditor(options: PageSectionOptionSet | null | undefined): boolean {
    const allowed = options?.allowed || [];
    return !options?.visual && allowed.length > 0 &&
        allowed.every(type => (sectionEditorTypes as readonly string[]).includes(type));
}
