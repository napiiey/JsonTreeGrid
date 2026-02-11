export class GridView {
    constructor(container, model) {
        this.container = container;
        this.model = model;
        this.selectedPath = null;
        this.editingCell = null;

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
            headerRow.appendChild(th);
        });
        thead.appendChild(headerRow);
        table.appendChild(thead);

        // ボディ
        const tbody = document.createElement('tbody');
        rows.forEach((rowData, rowIndex) => {
            const tr = document.createElement('tr');
            tr.className = 'grid-row';

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
