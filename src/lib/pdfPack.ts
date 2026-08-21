// Packs the שבצק print cards into PDF pages — two columns per page, cards
// placed whole (a card never splits across a column or page, mirroring the
// print CSS's break-inside-avoid), each new card dropped into the currently
// shortest column that still has room. The caller feeds cards tallest-first
// (same first-fit-decreasing order GroupsView uses for paper), so the big
// blocks anchor the columns and the small ones fill the gaps.
//
// All lengths are in the caller's unit (mm in practice); `y` is measured from
// the page's top content edge (below the top margin), and already includes
// the per-page header block.

export interface PackOptions {
    pageHeight: number;   // usable content height per page
    headerHeight: number; // header block redrawn at the top of every page
    headerGap: number;    // gap between the header and the first card
    cardGap: number;      // vertical gap between stacked cards
    columns?: number;     // default 2
}

export interface CardPlacement {
    page: number;   // 0-based
    col: number;    // 0 = first (right in RTL), 1 = next to it…
    y: number;      // top edge, from the page's top content edge
    height: number; // clamped to the column height for oversize cards
}

export function packCards(heights: number[], opts: PackOptions): CardPlacement[] {
    const columns = opts.columns ?? 2;
    const top = opts.headerHeight + (opts.headerHeight > 0 ? opts.headerGap : 0);
    const maxCardHeight = opts.pageHeight - top;

    let page = 0;
    let colY = new Array(columns).fill(top);
    const placements: CardPlacement[] = [];

    for (const rawH of heights) {
        const h = Math.min(rawH, maxCardHeight);
        // shortest column on the current page where the card still fits
        let best = -1;
        for (let c = 0; c < columns; c++) {
            if (colY[c] + h <= opts.pageHeight + 1e-6 && (best === -1 || colY[c] < colY[best])) {
                best = c;
            }
        }
        if (best === -1) {
            page++;
            colY = new Array(columns).fill(top);
            best = 0;
        }
        placements.push({page, col: best, y: colY[best], height: h});
        colY[best] += h + opts.cardGap;
    }
    return placements;
}
