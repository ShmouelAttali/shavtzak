// In-app landscape PDF export for the שבצק tab.
//
// Why not window.print(): desktop browsers honor the `@page {size: A4
// landscape}` rule in index.css, but mobile ones don't — Android hands the job
// to the system print service (portrait by default) and iOS WebKit ignores
// `size` entirely — so phones produced portrait sheets. Instead this renders
// the existing print layout in the live page, photographs the header and each
// GroupCard with html-to-image (the browser engine itself rasterizes, so
// Hebrew/RTL is exact), and lays the shots onto landscape A4 pages with jsPDF.
//
// The print layout only exists under `@media print` (Tailwind `print:` classes
// included), so for the duration of the capture every same-origin `print`
// media rule is flipped to `all` — behind a full-screen overlay — and flipped
// back in a finally.
//
// This module is dynamically imported by Shavtzak.tsx so jspdf/html-to-image
// stay out of the main bundle.

import {toJpeg} from 'html-to-image';
import {jsPDF} from 'jspdf';
import {packCards} from './pdfPack';

// A4 landscape, mirroring index.css's `@page {size: A4 landscape; margin: 7mm}`
const PAGE_W = 297, PAGE_H = 210, MARGIN = 7, COL_GAP = 6;
const CONTENT_W = PAGE_W - 2 * MARGIN;        // 283
const CONTENT_H = PAGE_H - 2 * MARGIN;        // 196
const COL_W = (CONTENT_W - COL_GAP) / 2;      // 138.5 — same as the print CSS columns
const PX_PER_MM = 96 / 25.4;                  // CSS reference pixel
const HEADER_GAP = 3, CARD_GAP = 3;           // mm

const pxToMm = (px: number) => px / PX_PER_MM;

function makeOverlay(): HTMLElement {
    const el = document.createElement('div');
    el.dir = 'rtl';
    el.textContent = 'מכין PDF…';
    Object.assign(el.style, {
        position: 'fixed', inset: '0', zIndex: '9999', background: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: '1.25rem', fontWeight: '600', color: '#334155',
    });
    document.body.appendChild(el);
    return el;
}

// Flip every same-origin `@media print` rule to `all` so the print layout
// applies live. Cross-origin sheets (Google Fonts) throw on .cssRules — skipped.
function flipPrintMedia(undo: Array<() => void>): void {
    for (const sheet of Array.from(document.styleSheets)) {
        let rules: CSSRuleList;
        try {
            rules = sheet.cssRules;
        } catch {
            continue;
        }
        for (const rule of Array.from(rules)) {
            if (rule instanceof CSSMediaRule && rule.media.mediaText === 'print') {
                rule.media.mediaText = 'all';
                undo.push(() => {
                    rule.media.mediaText = 'print';
                });
            }
        }
    }
}

function setStyle(el: HTMLElement, prop: string, value: string, undo: Array<() => void>): void {
    const prev = el.style.getPropertyValue(prop);
    const prevPriority = el.style.getPropertyPriority(prop);
    // `important` beats the print CSS's own `width: 100% !important` rules
    el.style.setProperty(prop, value, 'important');
    undo.push(() => {
        if (prev) el.style.setProperty(prop, prev, prevPriority);
        else el.style.removeProperty(prop);
    });
}

const nextFrame = () => new Promise<void>(r => requestAnimationFrame(() => requestAnimationFrame(() => r())));

const capture = (el: HTMLElement) =>
    toJpeg(el, {backgroundColor: '#fff', pixelRatio: 2, quality: 0.92});

export async function exportShavtzakPdf(filename: string): Promise<void> {
    const overlay = makeOverlay();
    const undo: Array<() => void> = [];
    try {
        await document.fonts.ready;
        await nextFrame(); // let the overlay paint before the layout flips under it

        flipPrintMedia(undo);

        const flow = document.querySelector<HTMLElement>('.print-flow');
        const headerEl = document.querySelector<HTMLElement>('.pdf-header');
        if (!flow) throw new Error('print layout not found');

        // Stack the cards at exactly one column's width (the multicol layout is
        // re-done by packCards), and the header at the full content width.
        setStyle(flow, 'columns', 'auto', undo);
        setStyle(flow, 'column-count', 'auto', undo);
        setStyle(flow, 'width', `${Math.round(COL_W * PX_PER_MM)}px`, undo);
        if (headerEl) setStyle(headerEl, 'width', `${Math.round(CONTENT_W * PX_PER_MM)}px`, undo);
        await nextFrame();

        const cards = Array.from(flow.children).filter((c): c is HTMLElement => c instanceof HTMLElement);
        const cardHeights = cards.map(c => pxToMm(c.getBoundingClientRect().height));
        const headerHeight = headerEl ? pxToMm(headerEl.getBoundingClientRect().height) : 0;

        const headerImg = headerEl ? await capture(headerEl) : null;
        const cardImgs: string[] = [];
        for (const card of cards) cardImgs.push(await capture(card));

        const placements = packCards(cardHeights, {
            pageHeight: CONTENT_H,
            headerHeight,
            headerGap: HEADER_GAP,
            cardGap: CARD_GAP,
        });

        const doc = new jsPDF({orientation: 'landscape', unit: 'mm', format: 'a4'});
        const pages = placements.length ? Math.max(...placements.map(p => p.page)) + 1 : 1;
        for (let p = 0; p < pages; p++) {
            if (p > 0) doc.addPage();
            if (headerImg) doc.addImage(headerImg, 'JPEG', MARGIN, MARGIN, CONTENT_W, headerHeight);
        }
        placements.forEach((place, i) => {
            doc.setPage(place.page + 1);
            // An oversize card is clamped by packCards — shrink it uniformly.
            const scale = place.height / cardHeights[i];
            const w = COL_W * Math.min(1, scale);
            // col 0 is the right column (RTL reading order); jsPDF x runs from the left
            const x = place.col === 0 ? PAGE_W - MARGIN - w : MARGIN;
            doc.addImage(cardImgs[i], 'JPEG', x, MARGIN + place.y, w, place.height);
        });

        doc.save(`${filename}.pdf`);
    } finally {
        for (const fn of undo.reverse()) fn();
        overlay.remove();
    }
}
