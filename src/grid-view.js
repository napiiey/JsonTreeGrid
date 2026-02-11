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
            this.startEdit(cell);
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

        const { parent, key, parentParts } = this.model.getParentAndKey(this.selectedPath);
        if (!parent) return;

        const isArrayParent = Array.isArray(parent);
        const table = document.createElement('table');
        table.className = 'grid-table';

        // カラムの決定
        let columns = [];
        let rows = [];

        if (isArrayParent) {
            // 親が配列の場合：配列の全要素を行にする
            rows = parent;
            // 全要素の全キーを網羅してカラムにする
            const keySet = new Set();
            parent.forEach(item => {
                if (item !== null && typeof item === 'object') {
                    Object.keys(item).forEach(k => keySet.add(k));
                }
            });
            columns = Array.from(keySet);
            if (columns.length === 0) columns = ['value']; // プリミティブ配列の場合
        } else {
            // 親がオブジェクトの場合：選択ノードとその兄弟を表示（1行のみ）
            rows = [parent];
            columns = Object.keys(parent);
        }

        // ヘッダー
        const thead = document.createElement('thead');
        const headerRow = document.createElement('tr');

        const indexTh = document.createElement('th');
        indexTh.textContent = '#';
        headerRow.appendChild(indexTh);

        columns.forEach(col => {
            const th = document.createElement('th');
            th.textContent = col;
            if (col === key) th.style.background = '#0078d4';
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
            tr.appendChild(indexTd);

            columns.forEach(col => {
                const td = document.createElement('td');
                td.className = 'grid-cell';
                const val = (rowData && typeof rowData === 'object') ? rowData[col] : rowData;
                td.textContent = val !== undefined ? val : '';

                // パスを保持
                let cellPath = '';
                if (isArrayParent) {
                    const base = this.partsToPath(parentParts);
                    cellPath = base ? `${base}[${rowIndex}]` : `root[${rowIndex}]`;
                    if (typeof rowData === 'object') cellPath += `.${col}`;
                } else {
                    const base = this.partsToPath(parentParts);
                    cellPath = base ? `${base}.${col}` : `root.${col}`;
                }
                td.dataset.path = cellPath;

                if (cellPath === this.selectedPath) {
                    td.classList.add('selected');
                }
                if (col === key) {
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

    startEdit(cell) {
        if (this.editingCell) this.stopEdit();

        this.editingCell = cell;
        const originalValue = cell.textContent;
        const input = document.createElement('input');
        input.value = originalValue;
        cell.textContent = '';
        cell.appendChild(input);
        input.focus();
        input.select();

        input.addEventListener('blur', () => this.stopEdit(true));
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') this.stopEdit(true);
            if (e.key === 'Escape') this.stopEdit(false);
        });
    }

    stopEdit(save = true) {
        if (!this.editingCell) return;
        const input = this.editingCell.querySelector('input');
        const newValue = input.value;
        const path = this.editingCell.dataset.path;

        if (save) {
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
