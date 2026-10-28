import { defineComponent } from 'vue';
const paths: Record<string, string> = {
    overview: 'M3 3h7v7H3z M14 3h7v7h-7z M3 14h7v7H3z M14 14h7v7h-7z',
    products: 'M5 7h14l2 14H3L5 7z M8 8V6a4 4 0 0 1 8 0v2',
    pages: 'M14 2H5v20h14V7l-5-5z M14 2v6h5 M8 12h8 M8 16h6',
    media: 'M3 3h18v18H3z M3 16l5-5 4 4 4-6 5 7 M8 7h.01',
    settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M9 3h6l1 3 3 1 2 5-2 5-3 1-1 3H9l-1-3-3-1-2-5 2-5 3-1 1-3z',
    release: 'M12 3l10 5-10 5L2 8l10-5z M2 12l10 5 10-5 M2 16l10 5 10-5',
    arrow: 'M5 12h14 M13 6l6 6-6 6',
    external: 'M14 3h7v7 M21 3l-11 11 M10 3H3v18h18v-7',
    chevron: 'M9 5l7 7-7 7',
    plus: 'M12 5v14 M5 12h14',
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    close: 'M6 6l12 12 M6 18L18 6',
    search: 'M10 3a7 7 0 1 0 0 14 7 7 0 0 0 0-14 M15 15l6 6',
};
export const StudioIcon = defineComponent({
    props: { name: { type: String, default: 'pages' }, size: { type: Number, default: 18 } },
    setup: props => () => <svg width={props.size} height={props.size} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d={paths[props.name] || paths.pages} /></svg>,
});
