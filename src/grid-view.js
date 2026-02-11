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
        let columns = [];
        if (isArray) {
            const keySet = new Set();
            rows.forEach(item => {
                if (item !== null && typeof item === 'object') {
                    Object.keys(item).forEach(k => keySet.add(k));
                }
            });
            columns = Array.from(keySet);
            if (columns.length === 0) columns = ['value'];
        } else {
            columns = Object.keys(rows[0] || {});
        }

        // カラムごとの最大値を計算（データバー用）
        const columnMaxMap = {};
        columns.forEach(col => {
            let max = -Infinity;
            let hasNumeric = false;
            rows.forEach(rowData => {
                const val = (rowData && typeof rowData === 'object') ? rowData[col] : rowData;
                const num = parseFloat(val);
                if (!isNaN(num)) {
                    if (num > max) max = num;
                    hasNumeric = true;
                }
            });
            if (hasNumeric && max > 0) {
                columnMaxMap[col] = max;
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

        // ヘッダー
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        const indexTh = document.createElement('th');
        indexTh.textContent = ''; // '#' を削除して空白にする
        indexTh.className = 'grid-index';
        headerRow.appendChild(indexTh);

        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            const hClass = getHeaderClass(col);
            if (hClass) th.classList.add(hClass);
            if (col === activeKey) th.style.background = '#0078d4';

            // 幅の適用
            if (this.columnWidths[col]) {
                th.style.width = `${this.columnWidths[col]}px`;
                th.style.minWidth = `${this.columnWidths[col]}px`;
            }

            // リサイズハンドルの追加
            const handle = document.createElement('div');
            handle.className = 'col-resize-handle';
            handle.dataset.col = col;
            th.appendChild(handle);

            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // ボディ
        const tbody = document.createElement('tbody');
        rows.forEach((rowData, rowIndex) => {
            const tr = document.createElement('tr');
            tr.className = 'grid-row';
            tr.dataset.index = rowIndex;
            tr.draggable = true; // 行全体をドラッグ可能に

            const indexTd = document.createElement('td');
            indexTd.textContent = rowIndex;
            indexTd.className = 'grid-index';
            tr.appendChild(indexTd);

            columns.forEach(col => {
                const td = document.createElement('td');
                td.className = 'grid-cell';
                const val = (rowData && typeof rowData === 'object') ? rowData[col] : rowData;
                td.textContent = val !== undefined ? (typeof val === 'object' ? JSON.stringify(val) : val) : '';

                // データバーの追加
                const num = parseFloat(val);
                if (columnMaxMap[col] !== undefined && !isNaN(num)) {
                    const max = columnMaxMap[col];
                    const percent = Math.min(100, Math.max(0, (num / max) * 100));

                    const bar = document.createElement('div');
                    bar.className = `data-bar ${getColorClass(col)}`;
                    bar.style.width = `${percent}%`;
                    td.classList.add('has-bar');
                    td.appendChild(bar);
                }

                // パスを保持
                let cellPath = this.partsToPath(parentParts);
                if (isArray) {
                    cellPath += `[${rowIndex}]`;
                    if (typeof rowData === 'object') cellPath += `.${col}`;
                } else {
                    cellPath += `.${col}`;
                }
                td.dataset.path = cellPath;

                if (cellPath === this.selectedPath) {
                    td.classList.add('selected');
                }
                if (col === activeKey) {
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
        const newWidth = Math.max(30, this.startWidth + diff);
        this.columnWidths[this.resizingCol] = newWidth;

        // 再描画せずに幅だけ更新（パフォーマンスのため）
        const ths = this.container.querySelectorAll('.grid-table th');
        ths.forEach(th => {
            if (th.textContent === this.resizingCol) {
                th.style.width = `${newWidth}px`;
                th.style.minWidth = `${newWidth}px`;
            }
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
