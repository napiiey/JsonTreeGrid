import { GRID_CONSTANTS } from './grid-constants.js';

/**
 * グリッドヘッダーの構築・ドラッグ＆ドロップ・折りたたみトグルを担当
 */
export class GridHeader {
    constructor(gridView) {
        this.grid = gridView;
    }

    buildColumnDefs(rows, currentPathParts = []) {
        const structureMap = new Map();
        rows.forEach(item => {
            if (item !== null && typeof item === 'object') {
                Object.keys(item).forEach(k => {
                    if (!structureMap.has(k)) structureMap.set(k, { subKeys: new Set(), isArray: false, isObject: false });
                    const val = item[k];
                    const info = structureMap.get(k);
                    if (val !== null && typeof val === 'object') {
                        if (Array.isArray(val)) {
                            info.isArray = true;
                            val.forEach((_, i) => info.subKeys.add(`[${i}]`));
                        } else {
                            info.isObject = true;
                            Object.keys(val).forEach(sk => info.subKeys.add(sk));
                        }
                    }
                });
            }
        });

        const defs = [];
        structureMap.forEach((info, key) => {
            const fullPathParts = [...currentPathParts, key];
            const fullPathStr = fullPathParts.join('.');
            const isCollapsible = info.isArray || info.isObject;
            let isExpanded = false;

            if (isCollapsible) {
                const defaultExpanded = info.isObject && !info.isArray;
                if (this.grid.collapsedPaths.has(fullPathStr)) isExpanded = false;
                else if (this.grid.expandedPaths.has(fullPathStr)) isExpanded = true;
                else isExpanded = defaultExpanded;
            }

            if (isExpanded && info.subKeys.size > 0) {
                const subItems = rows.map(it => it ? it[key] : undefined).filter(it => it !== undefined);
                this.buildColumnDefs(subItems, fullPathParts).forEach(sc => defs.push(sc));
            } else {
                defs.push({
                    path: fullPathParts,
                    name: key,
                    isCollapsible,
                    isCollapsed: !isExpanded,
                    isArray: info.isArray,
                    pathInfoMap: new Map([[fullPathStr, { isArray: info.isArray, isObject: info.isObject }]])
                });
            }
        });

        return defs.length > 0 ? defs : [{ path: ['value'], name: 'value', isCollapsible: false }];
    }

    buildColgroup(table, columnDefs, colInitialWidths) {
        const colgroup = document.createElement('colgroup');
        const indexCol = document.createElement('col');
        indexCol.style.width = `${GRID_CONSTANTS.INDEX_COL_WIDTH}px`;
        colgroup.appendChild(indexCol);

        let initialTableWidth = GRID_CONSTANTS.INDEX_COL_WIDTH;
        columnDefs.forEach(colDef => {
            const col = document.createElement('col');
            const colId = colDef.path.join('.');
            const width = colInitialWidths.get(colId);
            col.style.width = `${width}px`;
            col.dataset.colId = colId;
            colgroup.appendChild(col);
            initialTableWidth += width;
        });
        table.appendChild(colgroup);
        table.style.width = `${initialTableWidth}px`;
    }

    buildHeader(table, columnDefs, columnMaxMap, parentParts) {
        const thead = document.createElement('thead');
        const maxDepth = columnDefs.reduce((m, c) => Math.max(m, c.path.length), 0);

        for (let d = 0; d < maxDepth; d++) {
            const tr = document.createElement('tr');
            if (d === 0) {
                const indexTh = document.createElement('th');
                indexTh.className = 'grid-index';
                indexTh.setAttribute('rowspan', maxDepth);
                indexTh.style.cursor = 'pointer';
                indexTh.onclick = () => this.grid.selectAll();
                tr.appendChild(indexTh);
            }

            for (let i = 0; i < columnDefs.length; i++) {
                const col = columnDefs[i];
                const segment = col.path[d];
                if (segment === undefined) continue;

                const isNewGroup = i === 0 || !col.path.slice(0, d + 1).every((p, idx) => p === columnDefs[i - 1].path[idx]);
                if (isNewGroup) {
                    const th = this.createHeaderCell(col, d, i, columnDefs, maxDepth, columnMaxMap, parentParts);
                    tr.appendChild(th);
                }
            }
            thead.appendChild(tr);
        }
        table.appendChild(thead);
    }

    createHeaderCell(col, d, colIndex, columnDefs, maxDepth, columnMaxMap, parentParts) {
        const segment = col.path[d];
        const th = document.createElement('th');
        const content = document.createElement('div');
        content.className = 'th-content';
        content.textContent = segment;
        content.draggable = true;

        this.setupHeaderDragEvents(content, th, col, d, segment, parentParts);

        th.appendChild(content);

        if (!segment.startsWith('[')) {
            th.ondblclick = (e) => {
                e.stopPropagation();
                this.grid.editor.startHeaderEdit(th, segment, parentParts, col.path.slice(0, d));
            };
            th.oncontextmenu = (e) => this.grid.editor.showHeaderContextMenu(e, segment, parentParts, col.path.slice(0, d));
        }

        // Colspan
        let colspan = 1;
        for (let j = colIndex + 1; j < columnDefs.length; j++) {
            if (col.path.slice(0, d + 1).every((p, idx) => p === columnDefs[j].path[idx])) colspan++;
            else break;
        }
        if (colspan > 1) th.setAttribute('colspan', colspan);
        th.dataset.colIndex = colIndex;
        th.dataset.colCount = colspan;

        // Rowspan & Leaf Logic
        if (d === col.path.length - 1) {
            const rs = maxDepth - d;
            if (rs > 1) th.setAttribute('rowspan', rs);

            const colId = col.path.join('.');
            const handle = document.createElement('div');
            handle.className = 'col-resize-handle';
            handle.dataset.col = colId;
            th.dataset.colId = colId;
            th.appendChild(handle);

            if (columnMaxMap.has(col)) {
                const bar = document.createElement('div');
                bar.className = 'header-bar';
                bar.style.backgroundColor = this.grid.getBarColor(colIndex, 0.46);
                th.appendChild(bar);
            }
        }

        this.addHeaderToggle(th, col, d);
        th.style.top = `${d * GRID_CONSTANTS.HEADER_HEIGHT}px`;

        const hClass = (segment.toLowerCase().includes('name') || segment.toLowerCase().includes('id')) ? 'col-name' :
            (segment.toLowerCase().includes('stats') || segment.toLowerCase().includes('val')) ? 'col-val' : '';
        if (hClass) th.classList.add(hClass);

        return th;
    }

    setupHeaderDragEvents(content, th, col, d, segment, parentParts) {
        content.ondragstart = (e) => {
            if (e.target.classList.contains('col-resize-handle') || e.target.tagName === 'INPUT') {
                e.preventDefault();
                return;
            }
            e.dataTransfer.setData('application/json', JSON.stringify({
                path: col.path.slice(0, d + 1),
                parentPath: col.path.slice(0, d),
                key: segment
            }));
            e.dataTransfer.effectAllowed = 'move';
            th.classList.add('dragging-col');
        };

        content.ondragover = (e) => {
            e.preventDefault();
            if (document.querySelector('.dragging-col')) {
                const rect = th.getBoundingClientRect();
                const isLeft = e.clientX < rect.left + rect.width / 2;
                th.classList.toggle('header-drag-over-left', isLeft);
                th.classList.toggle('header-drag-over-right', !isLeft);
                e.dataTransfer.dropEffect = 'move';
            }
        };

        content.ondragleave = () => {
            th.classList.remove('header-drag-over-left', 'header-drag-over-right');
        };

        content.ondrop = (e) => {
            e.preventDefault();
            const isRight = th.classList.contains('header-drag-over-right');
            th.classList.remove('header-drag-over-left', 'header-drag-over-right');
            const rawOpt = e.dataTransfer.getData('application/json');
            if (!rawOpt) return;

            try {
                const srcData = JSON.parse(rawOpt);
                const targetParentPath = col.path.slice(0, d);
                if (JSON.stringify(srcData.parentPath) === JSON.stringify(targetParentPath)) {
                    const fullParentPath = [...parentParts, ...srcData.parentPath];
                    this.grid.model.moveKey(fullParentPath, srcData.key, segment, isRight);
                }
            } catch (err) { console.error(err); }
        };

        content.ondragend = () => {
            document.querySelectorAll('.dragging-col, .header-drag-over-left, .header-drag-over-right')
                .forEach(el => el.classList.remove('dragging-col', 'header-drag-over-left', 'header-drag-over-right'));
        };
    }

    addHeaderToggle(th, col, d) {
        const fullPathStr = col.path.slice(0, d + 1).join('.');
        if (col.isCollapsible && d === col.path.length - 1) {
            const toggle = document.createElement('span');
            toggle.className = 'grid-toggle';
            toggle.textContent = '▾';
            toggle.onclick = (e) => {
                e.stopPropagation();
                if (col.isArray) this.grid.expandedPaths.add(fullPathStr);
                else this.grid.collapsedPaths.delete(fullPathStr);
                this.grid.render();
            };
            th.appendChild(toggle);
        } else if (d < col.path.length - 1) {
            const toggle = document.createElement('span');
            toggle.className = 'grid-toggle';
            toggle.textContent = '▴';
            toggle.onclick = (e) => {
                e.stopPropagation();
                const segment = col.path[d];
                const isArrayNode = segment.startsWith('[') || this.grid.expandedPaths.has(fullPathStr);
                if (isArrayNode) this.grid.expandedPaths.delete(fullPathStr);
                else this.grid.collapsedPaths.add(fullPathStr);
                this.grid.render();
            };
            th.appendChild(toggle);
        }
    }
}
