import './style.css';
import { JsonModel } from './json-model.js';
import { TreeView } from './tree-view.js';
import { GridView } from './grid-view.js';

class App {
    constructor() {
        this.model = new JsonModel();
        this.treeView = new TreeView(document.getElementById('tree-container'), this.model);
        this.gridView = new GridView(document.getElementById('grid-container'), this.model);
        this.fileHandle = null;

        this.init();
    }

    init() {
        // モデルの変更を監視して各ビューに通知
        this.model.addEventListener('dataChange', () => {
            this.treeView.render();
            this.gridView.render();
        });

        this.model.addEventListener('selectionChange', (e) => {
            this.gridView.setSelection(e.detail.path);
        });

        // リサイザーの設定
        const resizer = document.getElementById('resizer');
        const leftPanel = document.getElementById('tree-panel');
        let isResizing = false;

        resizer.addEventListener('mousedown', () => {
            isResizing = true;
            document.body.style.cursor = 'col-resize';
        });

        document.addEventListener('mousemove', (e) => {
            if (!isResizing) return;
            const offsetRight = document.body.offsetWidth - e.clientX;
            const minWidth = 100;
            if (e.clientX > minWidth && offsetRight > minWidth) {
                leftPanel.style.width = `${e.clientX}px`;
            }
        });

        document.addEventListener('mouseup', () => {
            isResizing = false;
            document.body.style.cursor = 'default';
        });

        // --- メニューバーのイベント制御 ---
        // 1. メニューグループのトグル
        document.querySelectorAll('.menu-group').forEach(group => {
            group.querySelector('.menu-label').addEventListener('click', (e) => {
                e.stopPropagation();
                // 既に開いている他のメニューを閉じる
                document.querySelectorAll('.menu-group.active').forEach(activeGroup => {
                    if (activeGroup !== group) activeGroup.classList.remove('active');
                });
                group.classList.toggle('active');
            });
        });

        // 2. ドロップダウン内項目のクリック
        const menuActions = {
            'menu-new': () => this.newFile(),
            'menu-open': () => this.openFile(),
            'menu-save': () => this.saveFile(),
            'menu-save-as': () => this.saveFileAs(),
            'menu-undo': () => this.model.undo(),
            'menu-redo': () => this.model.redo(),
            'toolbar-undo': () => this.model.undo(),
            'toolbar-redo': () => this.model.redo(),
            'menu-cut': () => this.cutSelection(),
            'menu-copy': () => this.copySelection(),
            'menu-paste': () => this.pasteSelection(),
            'menu-delete': () => this.deleteSelection(),
            'toolbar-save': () => this.saveFile()
        };

        Object.keys(menuActions).forEach(id => {
            const el = document.getElementById(id);
            if (el) {
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    this.closeAllMenus();
                    menuActions[id]();
                });
            }
        });

        // 3. メニュー外クリックで閉じる
        document.addEventListener('click', () => {
            this.closeAllMenus();
        });

        // 4. ショートカットキー
        document.addEventListener('keydown', (e) => {
            // 入力中（inputやtextarea）はショートカットを無効化
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

            if (e.ctrlKey || e.metaKey) {
                const key = e.key.toLowerCase();
                if (key === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) this.model.redo();
                    else this.model.undo();
                } else if (key === 'y') {
                    e.preventDefault();
                    this.model.redo();
                } else if (key === 'c') {
                    e.preventDefault();
                    this.copySelection();
                } else if (key === 'x') {
                    e.preventDefault();
                    this.cutSelection();
                } else if (key === 'v') {
                    e.preventDefault();
                    this.pasteSelection();
                }
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                this.deleteSelection();
            }
        });

        // 初期データの読み込み（デモ用）
        this.newFile(true); // アプリ起動時はサンプルデータを表示

        // オフライン・データ保護のための localStorage 自動保存
        this.model.addEventListener('dataChange', () => {
            const data = this.model.getData();
            if (data) {
                localStorage.setItem('jsontreegrid_autosave', JSON.stringify(data));
            }
            this.updateToolbarStates();
        });

        // 起動時に未保存のデータがあるか確認
        this.restoreFromLocalStorage();
        this.updateToolbarStates();
    }

    updateToolbarStates() {
        const undoBtn = document.getElementById('toolbar-undo');
        const redoBtn = document.getElementById('toolbar-redo');
        if (undoBtn) undoBtn.disabled = !this.model.canUndo();
        if (redoBtn) redoBtn.disabled = !this.model.canRedo();
    }

    restoreFromLocalStorage() {
        const savedData = localStorage.getItem('jsontreegrid_autosave');
        if (savedData) {
            try {
                const data = JSON.parse(savedData);
                // 簡易的な確認
                if (confirm('前回の未保存データが見つかりました。復元しますか？')) {
                    this.model.setData(data);
                }
            } catch (e) {
                console.error('Failed to restore autosave', e);
            }
        }
    }

    closeAllMenus() {
        document.querySelectorAll('.menu-group.active').forEach(g => g.classList.remove('active'));
    }

    newFile(isInitial = false) {
        const defaultData = {
            "": ""
        };
        const demoData = {
            project: "JsonTreeGridSample",
            version: 1.0,
            settings: {
                theme: "dark",
                features: ["tree", "grid", "keyboard"]
            },
            monsters: [
                { id: 1, name: "スライム", stats: { hp: 10, atk: 1, int: 0, def: 1 } },
                { id: 2, name: "ゴブリン", stats: { hp: 15, atk: 2, int: 0, def: 2 } },
                { id: 3, name: "オーク", stats: { hp: 20, atk: 3, int: 0, def: 2 } },
                { id: 4, name: "マンドラゴラ", stats: { hp: 30, atk: 5, int: 2, def: 3 } },
                { id: 5, name: "ワーウルフ", stats: { hp: 40, atk: 8, int: 1, def: 4 } }
            ]
        };

        this.model.setData(isInitial ? demoData : defaultData);
        this.model.setSelection('root');
        this.fileHandle = null;
        document.getElementById('file-info').textContent = '新規ファイル';
    }

    async openFile() {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] }
                }]
            });
            const file = await handle.getFile();
            const text = await file.text();
            const json = JSON.parse(text);

            this.model.setData(json);
            this.fileHandle = handle;
            document.getElementById('file-info').textContent = file.name;
            this.model.setSelection('root');
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                alert('ファイルを開けませんでした');
            }
        }
    }

    async saveFile() {
        if (!this.fileHandle) {
            return this.saveFileAs();
        }

        try {
            const writable = await this.fileHandle.createWritable();
            const json = this.model.getData();
            await writable.write(JSON.stringify(json, null, 2));
            await writable.close();
            console.log('Saved to', this.fileHandle.name);
            // 保存成功したらオートセーブを消去して良いが、安全のため残しておくのも手
            // ここでは特に何もしない
        } catch (err) {
            console.error(err);
            if (err.name === 'AbortError') return;
            alert('保存に失敗しました。オフライン保存（localStorage）は継続されます。');
        }
    }

    async saveFileAs() {
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: 'data.json',
                types: [{
                    description: 'JSON Files',
                    accept: { 'application/json': ['.json'] }
                }]
            });
            this.fileHandle = handle;
            await this.saveFile();
            document.getElementById('file-info').textContent = handle.name;
        } catch (err) {
            if (err.name !== 'AbortError') {
                console.error(err);
                alert('名前を付けて保存に失敗しました');
            }
        }
    }

    async copySelection() {
        const range = this.gridView.getSelectedPaths();
        if (range.length === 0) return;

        const tsv = range.map(row => {
            return row.map(path => {
                if (!path) return '';
                const val = this.model.getValueByPath(this.model.parsePath(path));
                return (val !== null && typeof val === 'object') ? JSON.stringify(val) : (val === null ? '' : String(val));
            }).join('\t');
        }).join('\n');

        await navigator.clipboard.writeText(tsv);
    }

    async cutSelection() {
        await this.copySelection();
        this.deleteSelection();
    }

    async pasteSelection() {
        const anchorPath = this.model.selectionPath;
        if (!anchorPath || anchorPath === 'root') return;

        try {
            const text = await navigator.clipboard.readText();
            if (!text) return;

            const lines = text.split(/\r?\n/).filter(l => l.length > 0);
            const grid = lines.map(line => line.split('\t'));

            // アンカーセル（現在選択されている主セル）を探す
            const anchorCell = document.querySelector(`.grid-cell.selected`);
            if (!anchorCell) return;

            const startRow = parseInt(anchorCell.parentElement.dataset.index);
            const startCol = parseInt(anchorCell.dataset.colIndex);

            const updates = [];
            grid.forEach((row, ri) => {
                row.forEach((cellText, ci) => {
                    // 相対位置のセルを探す
                    const targetCell = document.querySelector(`.grid-row[data-index="${startRow + ri}"] .grid-cell[data-col-index="${startCol + ci}"]`);
                    if (targetCell) {
                        const path = targetCell.dataset.path;
                        let val;
                        try {
                            val = JSON.parse(cellText);
                        } catch {
                            if (!isNaN(cellText) && cellText.trim() !== '') {
                                val = Number(cellText);
                            } else if (cellText === 'true') {
                                val = true;
                            } else if (cellText === 'false') {
                                val = false;
                            } else if (cellText === 'null') {
                                val = null;
                            } else {
                                val = cellText;
                            }
                        }
                        updates.push({ path, value: val });
                    }
                });
            });

            if (updates.length > 0) {
                this.model.batchUpdateValues(updates);
            }
        } catch (err) {
            console.error('Paste failed', err);
        }
    }

    deleteSelection() {
        const range = this.gridView.getSelectedPaths();
        if (range.length === 0) return;

        const updates = [];
        range.flat().forEach(path => {
            if (path && path !== 'root') {
                updates.push({ path, value: null });
            }
        });

        if (updates.length > 0) {
            this.model.batchUpdateValues(updates);
        }
    }
}

new App();
