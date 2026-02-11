export class GridView {
    constructor(container, model) {
        this.container = container;
        this.model = model;
        this.selectedPath = null;
        this.editingCell = null;
        this.columnWidths = {}; // キー: カラム名, 値: 幅(px)

        // カラムリサイズ用の状態
        this.resizingCol = null;
        this.startX = 0;
        this.startWidth = 0;

        // 行ドラッグ用の状態
        this.draggedRowIndex = null;
        this.dragOverRowIndex = null;

        this.container.addEventListener('click', (e) => {
            const cell = e.target.closest('.grid-cell');
            if (!cell) return;
            this.selectCell(cell);
        });

        this.container.addEventListener('dblclick', (e) => {
            const cell = e.target.closest('.grid-cell');
            if (!cell) return;
            this.startEdit(cell, { append: true });
        });

        this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));

        // ドラッグ＆ドロップ（行の並べ替え）
        this.container.addEventListener('dragstart', (e) => this.handleDragStart(e));
        this.container.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.container.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.container.addEventListener('drop', (e) => this.handleDrop(e));
        this.container.addEventListener('dragend', (e) => this.handleDragEnd(e));

        window.addEventListener('keydown', (e) => this.handleKeyDown(e));
    }

    setSelection(path) {
        this.selectedPath = path;
        this.render();
    }

    render() {
        this.container.innerHTML = '';
        if (!this.selectedPath) return;

        const context = this.model.getGridContext(this.selectedPath);
        const { rows, parentParts, relativePath, isArray } = context;
        if (!rows) return;

        const activeKey = isArray ? (relativePath[0] || '') : relativePath[0];

        const table = document.createElement('table');
        table.className = 'grid-table';

        // カラムの決定
        let columnDefs = []; // { parent: string|null, name: string }
        if (isArray) {
            const structureMap = new Map(); // key -> Set of subkeys

            rows.forEach(item => {
                if (item !== null && typeof item === 'object') {
                    Object.keys(item).forEach(k => {
                        if (!structureMap.has(k)) structureMap.set(k, new Set());
                        const val = item[k];
                        if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                            Object.keys(val).forEach(subK => structureMap.get(k).add(subK));
                        }
                    });
                }
            });

            structureMap.forEach((subKeys, key) => {
                if (subKeys.size > 0) {
                    subKeys.forEach(subK => {
                        columnDefs.push({ parent: key, name: subK });
                    });
                } else {
                    columnDefs.push({ parent: null, name: key });
                }
            });

            if (columnDefs.length === 0) columnDefs = [{ parent: null, name: 'value' }];
        } else {
            const firstRow = rows[0] || {};
            Object.keys(firstRow).forEach(k => {
                const val = firstRow[k];
                if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
                    Object.keys(val).forEach(subK => {
                        columnDefs.push({ parent: k, name: subK });
                    });
                } else {
                    columnDefs.push({ parent: null, name: k });
                }
            });
        }

        // カラムごとの最大値を計算（データバー用）
        const columnMaxMap = new Map();
        columnDefs.forEach(colDef => {
            let max = -Infinity;
            let hasNumeric = false;
            rows.forEach(rowData => {
                const val = colDef.parent
                    ? (rowData && rowData[colDef.parent] ? rowData[colDef.parent][colDef.name] : undefined)
                    : (rowData && typeof rowData === 'object' ? rowData[colDef.name] : rowData);
                const num = parseFloat(val);
                if (!isNaN(num)) {
                    if (num > max) max = num;
                    hasNumeric = true;
                }
            });
            if (hasNumeric && max > 0) {
                columnMaxMap.set(colDef, max);
            }
        });

        // カラム名から色クラスへのマッピング
        const getColorClass = (col) => {
            const c = col.toLowerCase();
            if (c.includes('hp')) return 'bar-green';
            if (c.includes('atk')) return 'bar-red';
            if (c.includes('int')) return 'bar-blue';
            if (c.includes('def')) return 'bar-yellow';
            return 'bar-grey';
        };

        const getHeaderClass = (col) => {
            const c = col.toLowerCase();
            if (c.includes('hp')) return 'col-hp';
            if (c.includes('atk')) return 'col-atk';
            if (c.includes('int')) return 'col-int';
            if (c.includes('def')) return 'col-def';
            return '';
        };

        // ヘッダーの手前にcolgroupを追加
        const colgroup = document.createElement('colgroup');
        // Index列用
        const indexCol = document.createElement('col');
        indexCol.style.width = '40px';
        colgroup.appendChild(indexCol);

        columnDefs.forEach(colDef => {
            const col = document.createElement('col');
            const colId = colDef.parent ? `${colDef.parent}.${colDef.name}` : colDef.name;
            const width = this.columnWidths[colId] || 80;
            col.style.width = `${width}px`;
            col.dataset.colId = colId;
            colgroup.appendChild(col);
        });
        table.appendChild(colgroup);

        // テーブル全体の初期幅を設定
        const initialTableWidth = 40 + columnDefs.reduce((sum, colDef) => {
            const colId = colDef.parent ? `${colDef.parent}.${colDef.name}` : colDef.name;
            return sum + (this.columnWidths[colId] || 80);
        }, 0);
        table.style.width = `${initialTableWidth}px`;

        // ヘッダー
        const thead = document.createElement('thead');
        const headerRow1 = document.createElement('tr');
        const headerRow2 = document.createElement('tr');

        const indexTh = document.createElement('th');
        indexTh.textContent = '';
        indexTh.className = 'grid-index';
        indexTh.setAttribute('rowspan', '2');
        headerRow1.appendChild(indexTh);

        const processedParents = new Set();
        columnDefs.forEach((colDef, idx) => {
            if (colDef.parent === null) {
                const th = document.createElement('th');
                const content = document.createElement('div');
                content.className = 'th-content';
                content.textContent = colDef.name;
                th.appendChild(content);
                th.setAttribute('rowspan', '2');
                const hClass = getHeaderClass(colDef.name);
                if (hClass) th.classList.add(hClass);
                if (colDef.name === activeKey) th.style.background = '#0078d4';

                // 幅の適用
                const colId = colDef.name;

                // リサイズハンドル
                const handle = document.createElement('div');
                handle.className = 'col-resize-handle';
                handle.dataset.col = colId;
                th.dataset.colId = colId; // colIdを設定
                th.appendChild(handle);

                headerRow1.appendChild(th);
            } else {
                if (!processedParents.has(colDef.parent)) {
                    const parentTh = document.createElement('th');
                    const content = document.createElement('div');
                    content.className = 'th-content';
                    content.textContent = colDef.parent;
                    parentTh.appendChild(content);
                    const subCols = columnDefs.filter(c => c.parent === colDef.parent);
                    parentTh.setAttribute('colspan', subCols.length);
                    if (colDef.parent === activeKey) parentTh.style.background = '#0078d4';
                    headerRow1.appendChild(parentTh);
                    processedParents.add(colDef.parent);
                }

                const th = document.createElement('th');
                const content = document.createElement('div');
                content.className = 'th-content';
                content.textContent = colDef.name;
                th.appendChild(content);
                const hClass = getHeaderClass(colDef.name);
                if (hClass) th.classList.add(hClass);

                // 幅の適用
                const colId = `${colDef.parent}.${colDef.name}`;

                // リサイズハンドル
                const handle = document.createElement('div');
                handle.className = 'col-resize-handle';
                handle.dataset.col = colId;
                th.dataset.colId = colId; // colIdを設定
                th.appendChild(handle);

                headerRow2.appendChild(th);
            }
        });

        thead.appendChild(headerRow1);
        if (headerRow2.children.length > 0) {
            thead.appendChild(headerRow2);
        }
        table.appendChild(thead);

        // ボディ
        const tbody = document.createElement('tbody');
        rows.forEach((rowData, rowIndex) => {
            const tr = document.createElement('tr');
            tr.className = 'grid-row';
            tr.dataset.index = rowIndex;
            tr.draggable = true;

            const indexTd = document.createElement('td');
            indexTd.textContent = rowIndex;
            indexTd.className = 'grid-index';
            tr.appendChild(indexTd);

            columnDefs.forEach(colDef => {
                const td = document.createElement('td');
                td.className = 'grid-cell';

                const val = colDef.parent
                    ? (rowData && rowData[colDef.parent] ? rowData[colDef.parent][colDef.name] : undefined)
                    : (rowData && typeof rowData === 'object' ? rowData[colDef.name] : rowData);

                td.textContent = val !== undefined ? (typeof val === 'object' ? JSON.stringify(val) : val) : '';

                // データバー
                const num = parseFloat(val);
                const max = columnMaxMap.get(colDef);
                if (max !== undefined && !isNaN(num)) {
                    const percent = Math.min(100, Math.max(0, (num / max) * 100));
                    const bar = document.createElement('div');
                    bar.className = `data-bar ${getColorClass(colDef.name)}`;
                    bar.style.width = `${percent}%`;
                    td.classList.add('has-bar');
                    td.appendChild(bar);
                }

                // パス
                let cellPath = this.partsToPath(parentParts);
                if (isArray) {
                    cellPath += `[${rowIndex}]`;
                    if (typeof rowData === 'object') {
                        if (colDef.parent) {
                            cellPath += `.${colDef.parent}.${colDef.name}`;
                        } else {
                            cellPath += `.${colDef.name}`;
                        }
                    }
                } else {
                    if (colDef.parent) {
                        cellPath += `.${colDef.parent}.${colDef.name}`;
                    } else {
                        cellPath += `.${colDef.name}`;
                    }
                }
                td.dataset.path = cellPath;

                if (cellPath === this.selectedPath) {
                    td.classList.add('selected');
                }
                if (colDef.name === activeKey || colDef.parent === activeKey) {
                    td.classList.add('active-col');
                }

                tr.appendChild(td);
            });
            tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        this.container.appendChild(table);
    }

    // --- カラムリサイズ ---
    handleMouseDown(e) {
        if (e.target.classList.contains('col-resize-handle')) {
            this.resizingCol = e.target.dataset.col;
            this.startX = e.clientX;
            const th = e.target.parentElement;
            this.startWidth = th.offsetWidth;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
        }
    }

    handleMouseMove(e) {
        if (!this.resizingCol) return;
        const diff = e.clientX - this.startX;
        const newWidth = Math.max(5, this.startWidth + diff); // 最小幅を5pxに緩和
        this.columnWidths[this.resizingCol] = newWidth;

        // <col>の幅を更新
        const col = this.container.querySelector(`col[data-col-id="${this.resizingCol}"]`);
        if (col) {
            col.style.width = `${newWidth}px`;
        }

        // テーブル全体の幅を再計算して更新
        const table = this.container.querySelector('.grid-table');
        if (table) {
            let totalWidth = 40; // Index
            const cols = table.querySelectorAll('colgroup col[data-col-id]');
            cols.forEach(c => {
                totalWidth += parseFloat(c.style.width);
            });
            table.style.width = `${totalWidth}px`;
        }

        // 念のため対応する全thも更新して強制フラッシュさせる
        const ths = this.container.querySelectorAll(`.grid-table th[data-col-id="${this.resizingCol}"]`);
        ths.forEach(th => {
            th.style.width = `${newWidth}px`;
        });
    }

    handleMouseUp() {
        if (this.resizingCol) {
            this.resizingCol = null;
            document.body.style.cursor = 'default';
        }
    }

    // --- 行の並べ替え (Drag & Drop) ---
    handleDragStart(e) {
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
        if (index === this.draggedRowIndex) return;

        this.dragOverRowIndex = index;
        this.container.querySelectorAll('.grid-row').forEach(r => r.classList.remove('drag-over'));
        tr.classList.add('drag-over');
    }

    handleDragLeave(e) {
        const tr = e.target.closest('.grid-row');
        if (tr) tr.classList.remove('drag-over');
    }

    handleDrop(e) {
        e.preventDefault();
        const tr = e.target.closest('.grid-row');
        if (!tr || this.draggedRowIndex === null) return;

        const toIndex = parseInt(tr.dataset.index);
        const fromIndex = this.draggedRowIndex;

        if (fromIndex !== toIndex) {
            const context = this.model.getGridContext(this.selectedPath);
            const arrayPath = this.partsToPath(context.parentParts);
            console.log(`Move: ${fromIndex} -> ${toIndex}, arrayPath: ${arrayPath}`);
            this.model.moveArrayElement(arrayPath, fromIndex, toIndex);
        }

        this._cleanupDrag();
    }

    handleDragEnd(e) {
        this._cleanupDrag();
    }

    _cleanupDrag() {
        this.draggedRowIndex = null;
        this.dragOverRowIndex = null;
        this.container.querySelectorAll('.grid-row').forEach(r => {
            r.classList.remove('dragging', 'drag-over');
        });
    }

    partsToPath(parts) {
        let path = 'root';
        parts.forEach(p => {
            if (typeof p === 'number') path += `[${p}]`;
            else path += `.${p}`;
        });
        return path;
    }

    selectCell(cell) {
        document.querySelectorAll('.grid-cell.selected').forEach(c => c.classList.remove('selected'));
        cell.classList.add('selected');
        this.selectedPath = cell.dataset.path;
        // ツリー側も同期させたい場合はここに通知
    }

    startEdit(cell, options = {}) {
        if (this.editingCell) this.stopEdit();

        this.editingCell = cell;
        const originalValue = cell.textContent;
        const input = document.createElement('input');
        input.value = options.initialValue !== undefined ? options.initialValue : originalValue;
        cell.textContent = '';
        cell.appendChild(input);
        input.focus();

        if (options.append || options.initialValue !== undefined) {
            // 末尾にカーソルを置く（追記または上書き開始時）
            input.setSelectionRange(input.value.length, input.value.length);
        } else {
            // 全選択（通常編集開始時）
            input.select();
        }

        input.addEventListener('blur', () => {
            if (this.editingCell === cell) this.stopEdit(true);
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                this.stopEdit(true, true);
                e.preventDefault();
            }
            if (e.key === 'Escape') {
                this.stopEdit(false);
                e.preventDefault();
            }
        });
    }

    stopEdit(save = true, moveDown = false) {
        if (!this.editingCell) return;
        const cell = this.editingCell;
        const input = cell.querySelector('input');
        const newValue = input.value;
        const path = cell.dataset.path;

        let nextPath = null;
        if (moveDown) {
            const tr = cell.parentElement;
            const nextRow = tr.nextElementSibling;
            if (nextRow) {
                const cells = Array.from(tr.querySelectorAll('.grid-cell'));
                const colIndex = cells.indexOf(cell);
                const nextCell = nextRow.querySelectorAll('.grid-cell')[colIndex];
                if (nextCell) nextPath = nextCell.dataset.path;
            }
        }

        if (save) {
            if (nextPath) this.selectedPath = nextPath;
            this.model.updateValue(path, newValue);
        } else {
            this.render(); // 元に戻す
        }
        this.editingCell = null;
    }

    handleKeyDown(e) {
        if (this.editingCell) return;

        const selected = this.container.querySelector('.grid-cell.selected');
        if (!selected) return;

        if (e.key === 'Enter') {
            this.startEdit(selected);
            e.preventDefault();
            return;
        }

        // 上書き入力 (一文字の入力の場合)
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            this.startEdit(selected, { initialValue: e.key });
            e.preventDefault();
            return;
        }

        // 矢印キー移動
        const tr = selected.parentElement;
        const cells = Array.from(tr.querySelectorAll('.grid-cell'));
        const colIndex = cells.indexOf(selected);
        const rowIndex = Array.from(tr.parentElement.children).indexOf(tr);

        let nextCell = null;
        if (e.key === 'ArrowRight') {
            nextCell = cells[colIndex + 1];
        } else if (e.key === 'ArrowLeft') {
            nextCell = cells[colIndex - 1];
        } else if (e.key === 'ArrowDown') {
            const nextRow = tr.nextElementSibling;
            if (nextRow) nextCell = nextRow.querySelectorAll('.grid-cell')[colIndex];
        } else if (e.key === 'ArrowUp') {
            const prevRow = tr.previousElementSibling;
            if (prevRow) nextCell = prevRow.querySelectorAll('.grid-cell')[colIndex];
        }

        if (nextCell) {
            this.selectCell(nextCell);
            nextCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            e.preventDefault();
        }
    }
}
