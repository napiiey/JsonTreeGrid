/**
 * グリッドのセル編集・キーボード操作・ヘッダー名変更・コンテキストメニューを担当
 */
export class GridEditor {
    constructor(gridView) {
        this.grid = gridView;
    }

    startEdit(cell, options = {}) {
        if (this.grid.editingCell) this.stopEdit();

        this.grid.editingCell = cell;
        const originalValue = cell.textContent;
        const input = document.createElement('input');
        input.value = options.initialValue !== undefined ? options.initialValue : originalValue;
        cell.textContent = '';
        cell.appendChild(input);
        input.focus();

        requestAnimationFrame(() => {
            if (options.append || options.initialValue !== undefined) {
                const len = input.value.length;
                input.setSelectionRange(len, len);
            } else {
                input.select();
            }
        });

        input.addEventListener('blur', () => {
            if (this.grid.editingCell === cell) this.stopEdit(true);
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
        if (!this.grid.editingCell) return;
        const cell = this.grid.editingCell;
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
            if (nextPath) this.grid.selectedPath = nextPath;
            this.grid.model.updateValue(path, newValue);
        } else {
            this.grid.render();
        }
        this.grid.editingCell = null;
    }

    handleKeyDown(e) {
        if (this.grid.editingCell) return;

        const activeCell = this.grid.container.querySelector('.grid-cell.selected');
        if (!activeCell || !this.grid.selectionAnchor || !this.grid.selectionFocus) return;

        if (e.key === 'Enter') {
            this.startEdit(activeCell);
            e.preventDefault();
            return;
        }

        // 上書き入力 (一文字の入力の場合)
        if (e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
            this.startEdit(activeCell, { initialValue: e.key });
            e.preventDefault();
            return;
        }

        // 矢印キー移動・範囲拡大
        let nextRow = this.grid.selectionFocus.rowIndex;
        let nextCol = this.grid.selectionFocus.colIndex;

        if (e.key === 'ArrowRight') nextCol++;
        else if (e.key === 'ArrowLeft') nextCol--;
        else if (e.key === 'ArrowDown') nextRow++;
        else if (e.key === 'ArrowUp') nextRow--;
        else return;

        // 範囲外チェック
        const rows = this.grid.container.querySelectorAll('.grid-row');
        const maxRow = rows.length - 1;
        const maxCol = rows[0].querySelectorAll('.grid-cell').length - 1;

        nextRow = Math.max(0, Math.min(maxRow, nextRow));
        nextCol = Math.max(0, Math.min(maxCol, nextCol));

        if (e.shiftKey) {
            this.grid.selectionFocus = { rowIndex: nextRow, colIndex: nextCol };
        } else {
            this.grid.selectionAnchor = { rowIndex: nextRow, colIndex: nextCol };
            this.grid.selectionFocus = { rowIndex: nextRow, colIndex: nextCol };
        }

        this.grid.selection.updateSelectionUI();

        // スクロール追従
        const targetCell = this.grid.container.querySelector(`.grid-row[data-index="${nextRow}"] .grid-cell[data-col-index="${nextCol}"]`);
        if (targetCell) targetCell.scrollIntoView({ block: 'nearest', inline: 'nearest' });

        e.preventDefault();
    }

    // --- ヘッダーの名前変更 ---
    startHeaderEdit(th, oldKey, baseParts, subPathParts) {
        const content = th.querySelector('.th-content');
        const originalText = content.textContent;
        const input = document.createElement('input');
        input.type = 'text';
        input.value = originalText;
        input.className = 'header-edit-input';

        content.textContent = '';
        content.appendChild(input);
        input.focus();
        input.select();

        let finished = false;
        const finish = (save) => {
            if (finished) return;
            finished = true;
            const newKey = input.value.trim();
            if (save && newKey && newKey !== oldKey) {
                this.grid.model.renameKey(baseParts, subPathParts, oldKey, newKey);
            } else {
                content.textContent = originalText;
            }
        };

        input.onblur = () => finish(true);
        input.onkeydown = (e) => {
            if (e.key === 'Enter') {
                finish(true);
                e.preventDefault();
            }
            if (e.key === 'Escape') {
                finish(false);
                e.preventDefault();
            }
        };
    }

    showIndexContextMenu(e, rowIndex, parentParts) {
        e.preventDefault();
        const items = [
            {
                label: '上に1行挿入',
                action: () => {
                    const arrayPath = this.grid.model.partsToPath(parentParts);
                    this.grid.model.insertArrayElement(arrayPath, rowIndex);
                }
            },
            {
                label: '下に1行挿入',
                action: () => {
                    const arrayPath = this.grid.model.partsToPath(parentParts);
                    this.grid.model.insertArrayElement(arrayPath, rowIndex + 1);
                }
            },
            {
                label: 'この行を削除',
                action: () => {
                    const arrayPath = this.grid.model.partsToPath(parentParts);
                    this.grid.model.removeArrayElement(arrayPath, rowIndex);
                }
            }
        ];
        this.grid.contextMenu.show(e, items);
    }

    showHeaderContextMenu(e, key, parentParts, subPathParts) {
        e.preventDefault();
        e.stopPropagation();
        const items = [
            {
                label: '左に列を挿入',
                action: () => {
                    const fullParentPath = [...parentParts, ...subPathParts];
                    this.grid.model.insertKey(fullParentPath, key, false);
                }
            },
            {
                label: '右に列を挿入',
                action: () => {
                    const fullParentPath = [...parentParts, ...subPathParts];
                    this.grid.model.insertKey(fullParentPath, key, true);
                }
            },
            {
                label: 'この列を削除',
                action: () => {
                    const fullParentPath = [...parentParts, ...subPathParts];
                    this.grid.model.removeKey(fullParentPath, key);
                }
            }
        ];
        this.grid.contextMenu.show(e, items);
    }
}
