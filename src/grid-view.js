import { ContextMenu } from './context-menu.js';
import { GRID_CONSTANTS } from './grid-constants.js';
import { GridHeader } from './grid-header.js';
import { GridSelection } from './grid-selection.js';
import { GridEditor } from './grid-editor.js';

export class GridView {
    constructor(container, model) {
        this.container = container;
        this.model = model;
        this.selectedPath = null;
        this.editingCell = null;
        this.columnWidths = {};

        // カラムリサイズ用の状態
        this.resizingCol = null;
        this.startX = 0;
        this.startWidth = 0;

        // フラット化の開閉状態
        this.collapsedPaths = new Set();
        this.expandedPaths = new Set();

        // 行ドラッグ用の状態
        this.draggedRowIndex = null;
        this.dragOverRowIndex = null;

        // コンテキストメニュー
        this.contextMenu = new ContextMenu();

        // 範囲選択用の状態
        this.selectionAnchor = null;
        this.selectionFocus = null;
        this.isSelecting = false;

        // 仮想スクロール用の状態
        this.rowHeights = [];
        this.defaultRowHeight = GRID_CONSTANTS.DEFAULT_ROW_HEIGHT;
        this.bufferRows = GRID_CONSTANTS.BUFFER_ROWS;
        this.scrollTop = 0;
        this.viewportHeight = 0;

        // 折り返し設定されたカラムID
        this.wrappedColumnIds = new Set();
        this.headerSelection = null;
        this.isHeaderSelecting = false;

        // サブモジュール
        this.header = new GridHeader(this);
        this.selection = new GridSelection(this);
        this.editor = new GridEditor(this);

        this.initEvents();
    }

    initEvents() {
        this.container.addEventListener('dblclick', (e) => {
            const cell = e.target.closest('.grid-cell');
            if (!cell) return;
            this.editor.startEdit(cell, { append: true });
        });

        this.container.addEventListener('mousedown', (e) => this.selection.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.selection.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.selection.handleMouseUp(e));

        this.container.addEventListener('mouseover', (e) => {
            if (this.isSelecting) this.selection.handleSelectionDrag(e);
        });

        // ドラッグ＆ドロップ（行の並べ替え）
        this.container.addEventListener('dragstart', (e) => this.handleDragStart(e));
        this.container.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.container.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.container.addEventListener('drop', (e) => this.handleDrop(e));
        this.container.addEventListener('dragend', (e) => this.handleDragEnd(e));

        window.addEventListener('keydown', (e) => this.editor.handleKeyDown(e));

        this.scroller = this.container.parentElement;
        this.scroller.addEventListener('scroll', () => {
            if (!this.lastGridContext) return;
            this.scrollTop = this.scroller.scrollTop;
            this.updateVirtualRows();
        });

        this.resizeObserver = new ResizeObserver(() => {
            if (this.lastGridContext) this.updateVirtualRows();
        });
        this.resizeObserver.observe(this.scroller);
    }

    // --- 外部API (main.jsから呼ばれるメソッド群) ---

    setModel(model) {
        this.model = model;
        this.render();
    }

    setSelection(path) {
        this.selectedPath = path;
        this.render();
    }

    // main.jsからの呼び出し互換
    startEdit(cell, options) { this.editor.startEdit(cell, options); }
    finishEdit() { this.editor.stopEdit(); }
    selectCell(cell) { this.selection.selectCell(cell); }
    getSelectedPaths() { return this.selection.getSelectedPaths(); }
    toggleWrapSelection() { this.selection.toggleWrapSelection(); }
    isSelectionWrapped() { return this.selection.isSelectionWrapped(); }
    updateSelectionUI() { this.selection.updateSelectionUI(); }

    // --- レンダリング ---

    render() {
        this.container.innerHTML = '';
        if (!this.selectedPath) return;

        const context = this.model.getGridContext(this.selectedPath);
        const { rows } = context;
        if (!rows) return;

        const columnDefs = this.header.buildColumnDefs(rows);
        const { columnMaxMap, colInitialWidths } = this.calculateColumnStats(rows, columnDefs);

        this.columnMaxMap = columnMaxMap;
        this.columnDefs = columnDefs;
        this.lastGridContext = context;

        const table = document.createElement('table');
        table.className = 'grid-table';

        this.header.buildColgroup(table, columnDefs, colInitialWidths);
        this.header.buildHeader(table, columnDefs, columnMaxMap, context.parentParts);

        const tbody = document.createElement('tbody');
        table.appendChild(tbody);
        this.container.appendChild(table);

        this.updateVirtualRows();
    }

    // --- ユーティリティ ---

    getVisualLength(s) {
        if (s === null || s === undefined) return 0;
        const str = String(s);
        let len = 0;
        for (let i = 0; i < str.length; i++) {
            len += str.charCodeAt(i) > 255 ? 2 : 1;
        }
        return len;
    }

    calculateColumnStats(rows, columnDefs) {
        const columnMaxMap = new Map();
        const colInitialWidths = new Map();

        columnDefs.forEach(colDef => {
            const colId = colDef.path.join('.');
            let max = -Infinity;
            let hasNumeric = false;
            let maxLen = this.getVisualLength(colDef.name);

            rows.forEach(rowData => {
                const val = this.model.getValueByPath(colDef.path, rowData);
                const num = parseFloat(val);
                if (!isNaN(num)) {
                    if (num > max) max = num;
                    hasNumeric = true;
                }
                const visualLen = this.getVisualLength(val);
                if (visualLen > maxLen) maxLen = visualLen;
            });

            if (hasNumeric && max > 0) columnMaxMap.set(colDef, max);

            const savedWidth = this.columnWidths[colId];
            const finalWidth = savedWidth || Math.min(GRID_CONSTANTS.MAX_COL_WIDTH, Math.max(GRID_CONSTANTS.MIN_COL_WIDTH, maxLen * GRID_CONSTANTS.VISUAL_CHAR_WIDTH + 12));
            colInitialWidths.set(colId, finalWidth);
        });

        return { columnMaxMap, colInitialWidths };
    }

    getBarColor(colIndex, lightness = 0.36) {
        const totalCols = this.columnDefs ? this.columnDefs.length : 10;
        const hue = (colIndex * (360 / Math.max(totalCols, 5))) % 360;
        return `oklch(${lightness} 0.04 ${hue})`;
    }

    partsToPath(parts) {
        let path = 'root';
        parts.forEach(p => {
            if (typeof p === 'number') path += `[${p}]`;
            else path += `.${p}`;
        });
        return path;
    }

    // --- 仮想スクロール ---

    updateVirtualRows() {
        if (!this.lastGridContext) return;
        this.scrollTop = this.scroller.scrollTop;
        const { rows } = this.lastGridContext;
        const table = this.container.querySelector('.grid-table');
        if (!table) return;
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const totalRows = rows.length;
        if (this.rowHeights.length !== totalRows) {
            this.rowHeights = new Array(totalRows).fill(this.defaultRowHeight);
        }

        // 累積高さの計算
        const rowOffsets = new Array(totalRows + 1).fill(0);
        for (let i = 0; i < totalRows; i++) {
            rowOffsets[i + 1] = rowOffsets[i] + this.rowHeights[i];
        }
        const totalHeight = rowOffsets[totalRows];

        // 表示範囲の特定
        const viewportHeight = this.scroller.clientHeight;
        const startY = this.scrollTop;
        const endY = startY + viewportHeight;

        let startIndex = 0;
        while (startIndex < totalRows && rowOffsets[startIndex + 1] < startY) {
            startIndex++;
        }
        startIndex = Math.max(0, startIndex - this.bufferRows);

        let endIndex = startIndex;
        while (endIndex < totalRows && rowOffsets[endIndex] < endY) {
            endIndex++;
        }
        endIndex = Math.min(totalRows - 1, endIndex + this.bufferRows);

        // レンダリング
        tbody.innerHTML = '';

        if (startIndex > 0) {
            const topSpacer = document.createElement('tr');
            const td = document.createElement('td');
            td.setAttribute('colspan', this.columnDefs.length + 1);
            td.style.height = `${rowOffsets[startIndex]}px`;
            td.style.padding = '0';
            td.style.border = 'none';
            topSpacer.appendChild(td);
            tbody.appendChild(topSpacer);
        }

        for (let i = startIndex; i <= endIndex; i++) {
            const tr = this.createRowElement(rows[i], i);
            tbody.appendChild(tr);
        }

        if (endIndex < totalRows - 1) {
            const bottomSpacer = document.createElement('tr');
            const td = document.createElement('td');
            td.setAttribute('colspan', this.columnDefs.length + 1);
            td.style.height = `${totalHeight - rowOffsets[endIndex + 1]}px`;
            td.style.padding = '0';
            td.style.border = 'none';
            bottomSpacer.appendChild(td);
            tbody.appendChild(bottomSpacer);
        }

        this.selection.updateSelectionUI();

        // 実際の高さを計測してキャッシュを修正
        requestAnimationFrame(() => {
            let changed = false;
            const renderedRows = tbody.querySelectorAll('.grid-row');
            renderedRows.forEach(tr => {
                const idx = parseInt(tr.dataset.index);
                const actualH = tr.offsetHeight;
                if (Math.abs(this.rowHeights[idx] - actualH) > 0.5) {
                    this.rowHeights[idx] = actualH;
                    changed = true;
                }
            });
        });
    }

    createRowElement(rowData, rowIndex) {
        const { isArray, parentParts } = this.lastGridContext;
        const tr = document.createElement('tr');
        tr.className = 'grid-row';
        if (rowIndex % 2 === 0) tr.classList.add('grid-row-even');
        tr.dataset.index = rowIndex;

        const indexTd = document.createElement('td');
        indexTd.textContent = rowIndex;
        indexTd.className = 'grid-index';
        indexTd.draggable = true;
        if (isArray) {
            indexTd.oncontextmenu = (e) => this.editor.showIndexContextMenu(e, rowIndex, parentParts);
        }
        tr.appendChild(indexTd);

        this.columnDefs.forEach((colDef, colIndex) => {
            const td = document.createElement('td');
            td.className = 'grid-cell';
            td.dataset.colIndex = colIndex;

            const colId = colDef.path.join('.');
            if (this.wrappedColumnIds.has(colId)) {
                td.classList.add('cell-wrap');
            }

            const val = this.model.getValueByPath(colDef.path, rowData);

            if (val !== null && typeof val === 'object') {
                td.textContent = JSON.stringify(val);
                td.title = JSON.stringify(val, null, 2);
                td.classList.add('cell-object');
            } else {
                td.textContent = val !== undefined ? val : '';
            }

            // データバー
            const num = parseFloat(val);
            const max = this.columnMaxMap.get(colDef);
            if (max !== undefined && !isNaN(num)) {
                const percent = Math.min(100, Math.max(0, (num / max) * 100));
                const bar = document.createElement('div');
                bar.className = 'data-bar';
                bar.style.width = `${percent}%`;
                bar.style.backgroundColor = this.getBarColor(colIndex);
                td.classList.add('has-bar');
                td.appendChild(bar);
            }

            // パス
            let cellPath = this.partsToPath(parentParts);
            if (isArray) {
                cellPath += `[${rowIndex}]`;
            }
            colDef.path.forEach(p => {
                if (p.startsWith('[')) cellPath += p;
                else cellPath += (cellPath ? '.' : '') + p;
            });
            td.dataset.path = cellPath;
            if (this.selectionAnchor && this.selectionFocus) {
                const r1 = Math.min(this.selectionAnchor.rowIndex, this.selectionFocus.rowIndex);
                const r2 = Math.max(this.selectionAnchor.rowIndex, this.selectionFocus.rowIndex);
                const c1 = Math.min(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);
                const c2 = Math.max(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);

                const inRange = (rowIndex >= r1 && rowIndex <= r2 && colIndex >= c1 && colIndex <= c2);
                const isAnchor = (rowIndex === this.selectionAnchor.rowIndex && colIndex === this.selectionAnchor.colIndex);

                if (inRange) td.classList.add('range-selected');
                if (isAnchor) td.classList.add('selected');
            }

            tr.appendChild(td);
        });
        return tr;
    }

    // --- 行の並べ替え (Drag & Drop) ---

    handleDragStart(e) {
        if (!e.target.closest('.grid-index')) return;
        const tr = e.target.closest('.grid-row');
        if (!tr) return;
        this.draggedRowIndex = parseInt(tr.dataset.index);
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(this.draggedRowIndex));
        setTimeout(() => tr.classList.add('dragging'), 0);
    }

    handleDragOver(e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        const tr = e.target.closest('.grid-row');
        if (!tr) return;

        const index = parseInt(tr.dataset.index);
        if (index === this.draggedRowIndex) {
            this.container.querySelectorAll('.grid-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
            return;
        }

        const rect = tr.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isBottom = e.clientY > midY;

        this.container.querySelectorAll('.grid-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        tr.classList.add(isBottom ? 'drag-over-bottom' : 'drag-over-top');
    }

    handleDragLeave(e) {
        const tr = e.target.closest('.grid-row');
        if (tr) tr.classList.remove('drag-over-top', 'drag-over-bottom');
    }

    handleDrop(e) {
        e.preventDefault();
        const tr = e.target.closest('.grid-row');
        if (!tr || this.draggedRowIndex === null) return;

        const isBottom = tr.classList.contains('drag-over-bottom');
        let toIndex = parseInt(tr.dataset.index);
        const fromIndex = this.draggedRowIndex;

        if (isBottom) toIndex++;
        if (fromIndex < toIndex) toIndex--;

        if (fromIndex !== toIndex) {
            const context = this.model.getGridContext(this.selectedPath);
            const arrayPath = this.partsToPath(context.parentParts);
            this.model.moveArrayElement(arrayPath, fromIndex, toIndex);
        }

        this._cleanupDrag();
    }

    handleDragEnd() {
        this._cleanupDrag();
    }

    _cleanupDrag() {
        this.draggedRowIndex = null;
        this.dragOverRowIndex = null;
        this.container.querySelectorAll('.grid-row').forEach(r => {
            r.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
        });
    }
}
