/**
 * グリッドの範囲選択・マウスイベント・リサイズを担当
 */
export class GridSelection {
    constructor(gridView) {
        this.grid = gridView;
    }

    // --- マウスイベント (リサイズ / 範囲選択) ---
    handleMouseDown(e) {
        if (this.grid.editingCell) this.grid.editor.stopEdit();
        this.grid.contextMenu.hide();

        const cell = e.target.closest('.grid-cell');
        const indexCell = e.target.closest('.grid-index');
        const th = e.target.closest('th');
        const resizeHandle = e.target.closest('.col-resize-handle');

        if (resizeHandle) return this.handleResizeStart(e, resizeHandle);
        if (cell) return this.handleCellMouseDown(e, cell);
        if (indexCell) return this.handleIndexMouseDown(e, indexCell);
        if (th) return this.handleHeaderMouseDown(e, th);

        this.grid.isSelecting = false;
        this.updateSelectionUI();
    }

    handleResizeStart(e, handle) {
        this.grid.resizingCol = handle.dataset.col;
        this.grid.startX = e.clientX;
        const col = this.grid.container.querySelector(`col[data-col-id="${this.grid.resizingCol}"]`);
        this.grid.startWidth = parseInt(col.style.width);
        document.body.style.cursor = 'col-resize';
        e.preventDefault();
    }

    handleCellMouseDown(e, cell) {
        if (e.target.tagName === 'INPUT' || e.target.contentEditable === 'true') return;
        e.preventDefault();

        this.grid.isHeaderSelecting = false;
        const rowIndex = parseInt(cell.parentElement.dataset.index);
        const colIndex = parseInt(cell.dataset.colIndex);

        if (e.shiftKey && this.grid.selectionAnchor) {
            this.grid.selectionFocus = { rowIndex, colIndex };
        } else {
            this.grid.selectionAnchor = { rowIndex, colIndex };
            this.grid.selectionFocus = { rowIndex, colIndex };
            this.grid.isSelecting = true;
            this.grid.selectedPath = cell.dataset.path;
            this.grid.model.setSelection(this.grid.selectedPath);
        }
        this.updateSelectionUI();
    }

    handleIndexMouseDown(e, indexCell) {
        if (indexCell.tagName !== 'TD') return;
        e.preventDefault();
        const rowIndex = parseInt(indexCell.parentElement.dataset.index);
        const colCount = this.grid.columnDefs.length;

        if (e.shiftKey && this.grid.selectionAnchor) {
            this.grid.selectionFocus = { rowIndex, colIndex: colCount - 1 };
        } else {
            this.grid.selectionAnchor = { rowIndex, colIndex: 0 };
            this.grid.selectionFocus = { rowIndex, colIndex: colCount - 1 };
            this.grid.isSelecting = true;
        }
        this.updateSelectionUI();
        if (e.button === 2) this.grid.editor.showIndexContextMenu(e, rowIndex, this.grid.lastGridContext.parentParts);
    }

    handleHeaderMouseDown(e, th) {
        if (th.classList.contains('col-resize-handle') || e.target.classList.contains('grid-toggle')) return;
        const colIndex = parseInt(th.dataset.colIndex);
        if (isNaN(colIndex)) return;
        e.preventDefault();

        const colCount = parseInt(th.dataset.colCount);
        const rowCount = this.grid.lastGridContext.rows.length;

        if (e.shiftKey && this.grid.selectionAnchor) {
            this.grid.selectionFocus = { rowIndex: rowCount - 1, colIndex: colIndex + colCount - 1 };
        } else {
            this.grid.selectionAnchor = { rowIndex: 0, colIndex: colIndex };
            this.grid.selectionFocus = { rowIndex: rowCount - 1, colIndex: colIndex + colCount - 1 };
            this.grid.isSelecting = true;
        }

        this.grid.isHeaderSelecting = true;
        const colDef = this.grid.columnDefs[colIndex];
        if (colDef) {
            this.grid.headerSelection = {
                colId: colDef.path.join('.'),
                name: colDef.name,
                path: colDef.path
            };
        }
        this.updateSelectionUI();
    }

    handleSelectionDrag(e) {
        const cell = e.target.closest('.grid-cell');
        const indexCell = e.target.closest('.grid-index');
        const th = e.target.closest('th');

        if (cell) {
            this.grid.selectionFocus = {
                rowIndex: parseInt(cell.parentElement.dataset.index),
                colIndex: parseInt(cell.dataset.colIndex)
            };
        } else if (indexCell && indexCell.tagName === 'TD') {
            const rowIndex = parseInt(indexCell.parentElement.dataset.index);
            this.grid.selectionFocus = { rowIndex, colIndex: this.grid.columnDefs.length - 1 };
        } else if (th && !isNaN(parseInt(th.dataset.colIndex))) {
            const colIndex = parseInt(th.dataset.colIndex);
            const colCount = parseInt(th.dataset.colCount);
            this.grid.selectionFocus = { rowIndex: this.grid.lastGridContext.rows.length - 1, colIndex: colIndex + colCount - 1 };
        }
        this.updateSelectionUI();
    }

    handleMouseMove(e) {
        if (!this.grid.resizingCol) return;
        const diff = e.clientX - this.grid.startX;
        const newWidth = Math.max(5, this.grid.startWidth + diff);
        this.grid.columnWidths[this.grid.resizingCol] = newWidth;

        const col = this.grid.container.querySelector(`col[data-col-id="${this.grid.resizingCol}"]`);
        if (col) col.style.width = `${newWidth}px`;

        const table = this.grid.container.querySelector('.grid-table');
        if (table) {
            let totalWidth = 40;
            table.querySelectorAll('colgroup col[data-col-id]').forEach(c => {
                totalWidth += parseFloat(c.style.width);
            });
            table.style.width = `${totalWidth}px`;
        }

        this.grid.container.querySelectorAll(`.grid-table th[data-col-id="${this.grid.resizingCol}"]`).forEach(th => {
            th.style.width = `${newWidth}px`;
        });
    }

    handleMouseUp() {
        if (this.grid.resizingCol) {
            this.grid.resizingCol = null;
            document.body.style.cursor = 'default';
        }
        this.grid.isSelecting = false;
    }

    updateSelectionUI() {
        if (!this.grid.selectionAnchor || !this.grid.selectionFocus) return;

        const r1 = Math.min(this.grid.selectionAnchor.rowIndex, this.grid.selectionFocus.rowIndex);
        const r2 = Math.max(this.grid.selectionAnchor.rowIndex, this.grid.selectionFocus.rowIndex);
        const c1 = Math.min(this.grid.selectionAnchor.colIndex, this.grid.selectionFocus.colIndex);
        const c2 = Math.max(this.grid.selectionAnchor.colIndex, this.grid.selectionFocus.colIndex);

        this.grid.container.querySelectorAll('.grid-cell').forEach(td => {
            const r = parseInt(td.parentElement.dataset.index);
            const c = parseInt(td.dataset.colIndex);

            const inRange = (r >= r1 && r <= r2 && c >= c1 && c <= c2);
            td.classList.toggle('range-selected', inRange);
            td.classList.toggle('selected', r === this.grid.selectionAnchor.rowIndex && c === this.grid.selectionAnchor.colIndex);
        });

        // アクティブな項目の通知
        if (this.grid.isHeaderSelecting && this.grid.headerSelection) {
            this.grid.model.dispatchEvent(new CustomEvent('selectionChange', {
                detail: {
                    path: this.grid.selectedPath,
                    header: this.grid.headerSelection,
                    type: 'key'
                }
            }));
        } else {
            const activeCell = this.grid.container.querySelector(`.grid-row[data-index="${this.grid.selectionAnchor.rowIndex}"] .grid-cell[data-col-index="${this.grid.selectionAnchor.colIndex}"]`);
            this.grid.headerSelection = null;

            if (activeCell && activeCell.dataset.path !== this.grid.selectedPath) {
                this.grid.selectedPath = activeCell.dataset.path;
                this.grid.model.setSelection(this.grid.selectedPath);
            } else {
                this.grid.model.dispatchEvent(new CustomEvent('selectionChange', {
                    detail: {
                        path: this.grid.selectedPath,
                        type: 'value'
                    }
                }));
            }
        }
    }

    selectCell(cell) {
        const rowIndex = parseInt(cell.parentElement.dataset.index);
        const colIndex = parseInt(cell.dataset.colIndex);
        this.grid.selectionAnchor = { rowIndex, colIndex };
        this.grid.selectionFocus = { rowIndex, colIndex };
        this.updateSelectionUI();
    }

    toggleWrapSelection() {
        if (!this.grid.selectionAnchor || !this.grid.selectionFocus) return;

        const c1 = Math.min(this.grid.selectionAnchor.colIndex, this.grid.selectionFocus.colIndex);
        const c2 = Math.max(this.grid.selectionAnchor.colIndex, this.grid.selectionFocus.colIndex);

        const firstColId = this.grid.columnDefs[c1]?.path.join('.');
        const shouldWrap = firstColId ? !this.grid.wrappedColumnIds.has(firstColId) : true;

        for (let i = c1; i <= c2; i++) {
            const colId = this.grid.columnDefs[i]?.path.join('.');
            if (colId) {
                if (shouldWrap) this.grid.wrappedColumnIds.add(colId);
                else this.grid.wrappedColumnIds.delete(colId);
            }
        }
        this.grid.rowHeights = [];
        this.grid.updateVirtualRows();
        this.grid.render();
        this.grid.model.dispatchEvent(new CustomEvent('selectionChange', { detail: { path: this.grid.selectedPath } }));
    }

    isSelectionWrapped() {
        if (!this.grid.selectionAnchor) return false;
        const colId = this.grid.columnDefs[this.grid.selectionAnchor.colIndex]?.path.join('.');
        return this.grid.wrappedColumnIds.has(colId);
    }

    getSelectedPaths() {
        if (!this.grid.selectionAnchor || !this.grid.selectionFocus || !this.grid.lastGridContext) return [];
        const { rows, isArray, parentParts } = this.grid.lastGridContext;

        const r1 = Math.min(this.grid.selectionAnchor.rowIndex, this.grid.selectionFocus.rowIndex);
        const r2 = Math.max(this.grid.selectionAnchor.rowIndex, this.grid.selectionFocus.rowIndex);
        const c1 = Math.min(this.grid.selectionAnchor.colIndex, this.grid.selectionFocus.colIndex);
        const c2 = Math.max(this.grid.selectionAnchor.colIndex, this.grid.selectionFocus.colIndex);

        const range = [];
        for (let r = r1; r <= r2; r++) {
            const row = [];
            for (let c = c1; c <= c2; c++) {
                const colDef = this.grid.columnDefs[c];
                if (!colDef) { row.push(null); continue; }

                let cellPath = this.grid.partsToPath(parentParts);
                if (isArray) cellPath += `[${r}]`;
                colDef.path.forEach(p => {
                    if (p.startsWith('[')) cellPath += p;
                    else cellPath += (cellPath ? '.' : '') + p;
                });
                row.push(cellPath);
            }
            range.push(row);
        }
        return range;
    }
}
