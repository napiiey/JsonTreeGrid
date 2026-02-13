import './style.css';
import { JsonModel } from './json-model.js';
import { TreeView } from './tree-view.js';
import { GridView } from './grid-view.js';

class App {
    constructor() {
        this.tabs = [];
        this.activeTabIndex = -1;
        this.treeView = new TreeView(document.getElementById('tree-container'), null);
        this.gridView = new GridView(document.getElementById('grid-container'), null);

        // イベントバインドの準備
        this.onDataChangeBound = () => this.onDataChange();
        this.onSelectionChangeBound = (e) => this.onSelectionChange(e);

        this.init();
    }

    init() {
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
        document.querySelectorAll('.menu-group').forEach(group => {
            group.querySelector('.menu-label').addEventListener('click', (e) => {
                e.stopPropagation();
                document.querySelectorAll('.menu-group.active').forEach(activeGroup => {
                    if (activeGroup !== group) activeGroup.classList.remove('active');
                });
                group.classList.toggle('active');
            });
        });

        const menuActions = {
            'menu-new': () => this.newFile(),
            'menu-open': () => this.openFile(),
            'menu-save': () => this.saveFile(),
            'menu-save-as': () => this.saveFileAs(),
            'menu-undo': () => this.activeModel?.undo(),
            'menu-redo': () => this.activeModel?.redo(),
            'toolbar-undo': () => this.activeModel?.undo(),
            'toolbar-redo': () => this.activeModel?.redo(),
            'toolbar-wrap': () => this.gridView.toggleWrapSelection(),
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

        document.addEventListener('click', () => this.closeAllMenus());

        // ショートカットキー
        document.addEventListener('keydown', (e) => {
            if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
            const key = e.key.toLowerCase();
            const isCtrl = e.ctrlKey || e.metaKey;

            if (isCtrl) {
                const shortcuts = {
                    's': () => { e.preventDefault(); e.shiftKey ? this.saveFileAs() : this.saveFile(); },
                    'o': () => { e.preventDefault(); this.openFile(); },
                    'z': () => { e.preventDefault(); e.shiftKey ? this.activeModel?.redo() : this.activeModel?.undo(); },
                    'y': () => { e.preventDefault(); this.activeModel?.redo(); },
                    'c': () => { e.preventDefault(); this.copySelection(); },
                    'x': () => { e.preventDefault(); this.cutSelection(); },
                    'v': () => { e.preventDefault(); this.pasteSelection(); }
                };
                if (shortcuts[key]) shortcuts[key]();
            } else if (e.key === 'Delete' || e.key === 'Backspace') {
                this.deleteSelection();
            }
        });

        // ツールバー入力
        const toolbarInput = document.getElementById('toolbar-input');
        if (toolbarInput) {
            toolbarInput.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') {
                    this.applyToolbarEdit();
                    toolbarInput.blur();
                } else if (e.key === 'Escape') {
                    this.updateToolbarInput(this.currentSelectionDetail);
                    toolbarInput.blur();
                }
            });
            toolbarInput.addEventListener('blur', () => this.applyToolbarEdit());
        }

        this.setupDragAndDrop();

        // 初期タブの作成（デモ用）
        this.newFile(true);
        this.restoreFromLocalStorage();
        this.updateToolbarStates();
    }

    get activeModel() {
        return this.tabs[this.activeTabIndex]?.model || null;
    }

    get activeTab() {
        return this.tabs[this.activeTabIndex] || null;
    }

    // --- タブ管理 ---
    addTab(data, filename = '新規ファイル', fileHandle = null) {
        const model = new JsonModel();
        model.setData(data);
        model.setSelection('root');

        const tab = {
            model,
            filename,
            fileHandle,
            isDirty: false
        };

        this.tabs.push(tab);
        this.switchTab(this.tabs.length - 1);
        this.renderTabs();
    }

    switchTab(index) {
        if (index === this.activeTabIndex) return;

        // 以前のモデルからリスナーを解除
        if (this.activeModel) {
            this.activeModel.removeEventListener('dataChange', this.onDataChangeBound);
            this.activeModel.removeEventListener('selectionChange', this.onSelectionChangeBound);
        }

        this.activeTabIndex = index;

        // 新しいモデルにリスナーを登録
        if (this.activeModel) {
            this.activeModel.addEventListener('dataChange', this.onDataChangeBound);
            this.activeModel.addEventListener('selectionChange', this.onSelectionChangeBound);

            this.treeView.setModel(this.activeModel);
            this.gridView.setModel(this.activeModel);

            // ビューの初期選択を反映
            const sel = this.activeModel.selectionPath;
            this.gridView.setSelection(sel);
            this.updateToolbarInput({ path: sel });
        }

        document.title = `${this.activeTab?.filename || 'JsonTreeGrid'} - JsonTreeGrid`;
        this.renderTabs();
        this.updateToolbarStates();
    }

    async closeTab(index) {
        const tab = this.tabs[index];
        if (tab.isDirty) {
            if (!confirm(`${tab.filename} は変更されています。保存せずに閉じますか？`)) {
                return;
            }
        }

        this.tabs.splice(index, 1);

        if (this.tabs.length === 0) {
            this.newFile();
        } else {
            const nextIndex = Math.min(index, this.tabs.length - 1);
            this.activeTabIndex = -1; // 強制的にスイッチさせるため
            this.switchTab(nextIndex);
        }
        this.renderTabs();
    }

    renderTabs() {
        const container = document.getElementById('tab-container');
        if (!container) return;

        container.innerHTML = '';
        this.tabs.forEach((tab, index) => {
            const tabEl = document.createElement('div');
            tabEl.className = `tab ${index === this.activeTabIndex ? 'active' : ''}`;

            const nameEl = document.createElement('span');
            nameEl.className = 'tab-name';
            nameEl.textContent = tab.filename + (tab.isDirty ? ' *' : '');
            tabEl.appendChild(nameEl);

            const closeBtn = document.createElement('span');
            closeBtn.className = 'tab-close';
            closeBtn.innerHTML = '&times;';
            closeBtn.onclick = (e) => {
                e.stopPropagation();
                this.closeTab(index);
            };
            tabEl.appendChild(closeBtn);

            tabEl.onclick = () => this.switchTab(index);
            container.appendChild(tabEl);
        });
    }

    // --- イベントハンドラ ---
    onDataChange() {
        this.treeView.render();
        this.gridView.render();
        if (this.activeTab) {
            this.activeTab.isDirty = true;
            // オートセーブ (アクティブなファイル名で保存)
            const data = this.activeModel.getData();
            if (data) {
                localStorage.setItem(`jsontreegrid_autosave_${this.activeTab.filename}`, JSON.stringify(data));
            }
        }
        this.renderTabs();
        this.updateToolbarStates();
    }

    onSelectionChange(e) {
        this.gridView.setSelection(e.detail.path, e.detail);
        this.updateToolbarStates();
        this.updateToolbarInput(e.detail);
    }

    // --- ファイル操作 ---
    newFile(isInitial = false) {
        const demoData = {
            project: "JsonTreeGridSample",
            version: 1.0,
            settings: { theme: "dark", features: ["tree", "grid", "keyboard", "tabs"] },
            monsters: [
                { id: 1, name: "スライム", stats: { hp: 10, atk: 1, int: 0, def: 1 } },
                { id: 2, name: "ゴブリン", stats: { hp: 15, atk: 2, int: 0, def: 2 } }
            ]
        };
        const defaultData = { "": "" };
        this.addTab(isInitial ? demoData : defaultData, isInitial ? 'sample.json' : '新規ファイル');
    }

    async openFile() {
        try {
            const [handle] = await window.showOpenFilePicker({
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
            });
            const file = await handle.getFile();
            const text = await file.text();
            const json = JSON.parse(text);
            this.addTab(json, file.name, handle);
        } catch (err) {
            if (err.name !== 'AbortError') alert('ファイルを開けませんでした');
        }
    }

    async saveFile() {
        const tab = this.activeTab;
        if (!tab) return;
        if (!tab.fileHandle) return this.saveFileAs();

        try {
            const writable = await tab.fileHandle.createWritable();
            await writable.write(JSON.stringify(tab.model.getData(), null, 2));
            await writable.close();
            tab.isDirty = false;
            this.renderTabs();
            this.updateToolbarStates();
        } catch (err) {
            if (err.name !== 'AbortError') alert('保存に失敗しました');
        }
    }

    async saveFileAs() {
        const tab = this.activeTab;
        if (!tab) return;
        try {
            const handle = await window.showSaveFilePicker({
                suggestedName: tab.filename,
                types: [{ description: 'JSON Files', accept: { 'application/json': ['.json'] } }]
            });
            tab.fileHandle = handle;
            tab.filename = handle.name;
            await this.saveFile();
        } catch (err) {
            if (err.name !== 'AbortError') alert('保存に失敗しました');
        }
    }

    // --- その他 ---
    setupDragAndDrop() {
        const overlay = document.createElement('div');
        overlay.className = 'drop-overlay';
        overlay.innerHTML = '<div class="drop-message">Drop JSON file to open in a new tab</div>';
        document.body.appendChild(overlay);

        let dragCounter = 0;
        document.addEventListener('dragenter', (e) => { e.preventDefault(); dragCounter++; overlay.classList.add('active'); });
        document.addEventListener('dragleave', (e) => { e.preventDefault(); dragCounter--; if (dragCounter === 0) overlay.classList.remove('active'); });
        document.addEventListener('dragover', (e) => e.preventDefault());
        document.addEventListener('drop', async (e) => {
            e.preventDefault();
            dragCounter = 0;
            overlay.classList.remove('active');
            if (e.dataTransfer.files) {
                for (const file of e.dataTransfer.files) {
                    if (file.name.endsWith('.json')) {
                        const text = await file.text();
                        this.addTab(JSON.parse(text), file.name);
                    }
                }
            }
        });
    }

    restoreFromLocalStorage() {
        // 全てのオートセーブを探すのは困難なので、特定プレフィックスのキーを列挙
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key.startsWith('jsontreegrid_autosave_')) {
                const filename = key.replace('jsontreegrid_autosave_', '');
                if (confirm(`未保存のデータ ${filename} が見つかりました。復元して開きますか？`)) {
                    try {
                        const data = JSON.parse(localStorage.getItem(key));
                        this.addTab(data, filename);
                    } catch (e) {
                        console.error('Failed to restore', e);
                    }
                }
                // 一度開いたらクリアするか、そのままにするか。ここではクリアする。
                localStorage.removeItem(key);
            }
        }
    }

    updateToolbarInput(detail) {
        this.currentSelectionDetail = detail;
        const input = document.getElementById('toolbar-input');
        if (!input) return;
        if (!detail || (!detail.path && !detail.header) || !this.activeModel) {
            input.value = '';
            input.disabled = true;
            return;
        }
        input.disabled = false;
        if (detail.header) {
            input.value = detail.header.name;
        } else {
            const val = this.activeModel.getValueByPath(this.activeModel.parsePath(detail.path));
            input.value = (val !== null && typeof val === 'object') ? JSON.stringify(val) : (val !== undefined ? String(val) : '');
        }
    }

    applyToolbarEdit() {
        if (!this.currentSelectionDetail || !this.activeModel) return;
        const input = document.getElementById('toolbar-input');
        if (!input || input.disabled) return;
        const newValue = input.value;
        const detail = this.currentSelectionDetail;
        if (detail.header) {
            const { path } = detail.header;
            this.activeModel.renameKey(path.slice(0, -1), [], path[path.length - 1], newValue);
        } else if (detail.path) {
            const parts = this.activeModel.parsePath(detail.path);
            const oldVal = this.activeModel.getValueByPath(parts);
            if (String(oldVal) !== newValue) {
                let typedValue = newValue;
                if (typeof oldVal === 'number') typedValue = Number(newValue);
                else if (typeof oldVal === 'boolean') typedValue = newValue.toLowerCase() === 'true';
                else if (typeof oldVal === 'object' && oldVal !== null) { try { typedValue = JSON.parse(newValue); } catch (e) { } }
                this.activeModel.updateValue(detail.path, typedValue);
            }
        }
    }

    updateToolbarStates() {
        const undoBtn = document.getElementById('toolbar-undo');
        const redoBtn = document.getElementById('toolbar-redo');
        const saveBtn = document.getElementById('toolbar-save');
        const wrapBtn = document.getElementById('toolbar-wrap');
        if (undoBtn) undoBtn.disabled = !this.activeModel?.canUndo();
        if (redoBtn) redoBtn.disabled = !this.activeModel?.canRedo();
        if (saveBtn) saveBtn.disabled = !this.activeTab?.isDirty;
        if (wrapBtn) {
            const isWrapped = this.gridView.isSelectionWrapped();
            const path = wrapBtn.querySelector('path');
            if (path) path.setAttribute('d', isWrapped ? 'M4 19h6v-2H4v2zM20 5H4v2h16V5zm-7 6H4v2h9c1.65 0 3 1.35 3 3s-1.35 3-3 3h-1v-1.5L7 19l4 3.5V21h2c2.76 0 5-2.24 5-5s-2.24-5-5-5z' : 'M4 19h6v-2H4v2zM20 5H4v2h16V5zm-3 6H4v2h13.25c1.1 0 2 .9 2 2s-.9 2-2 2H15v-1.5L11 15l4 3.5V17h2.25c2.21 0 4-1.79 4-4s-1.79-4-4-4z');
        }
    }

    closeAllMenus() {
        document.querySelectorAll('.menu-group.active').forEach(g => g.classList.remove('active'));
    }

    async copySelection() {
        const range = this.gridView.getSelectedPaths();
        if (range.length === 0 || !this.activeModel) return;
        const tsv = range.map(row => row.map(path => {
            if (!path) return '';
            const val = this.activeModel.getValueByPath(this.activeModel.parsePath(path));
            return (val !== null && typeof val === 'object') ? JSON.stringify(val) : (val === null ? '' : String(val));
        }).join('\t')).join('\n');
        await navigator.clipboard.writeText(tsv);
    }

    async cutSelection() { await this.copySelection(); this.deleteSelection(); }

    async pasteSelection() {
        const anchorCell = document.querySelector(`.grid-cell.selected`);
        if (!anchorCell || !this.activeModel) return;
        try {
            const text = await navigator.clipboard.readText();
            if (!text) return;
            const lines = text.split(/\r?\n/).filter(l => l.length > 0);
            const grid = lines.map(line => line.split('\t'));
            const startRow = parseInt(anchorCell.parentElement.dataset.index);
            const startCol = parseInt(anchorCell.dataset.colIndex);
            const updates = [];
            grid.forEach((row, ri) => {
                row.forEach((cellText, ci) => {
                    const targetCell = document.querySelector(`.grid-row[data-index="${startRow + ri}"] .grid-cell[data-col-index="${startCol + ci}"]`);
                    if (targetCell) {
                        const path = targetCell.dataset.path;
                        let val;
                        try { val = JSON.parse(cellText); } catch {
                            if (!isNaN(cellText) && cellText.trim() !== '') val = Number(cellText);
                            else if (cellText === 'true') val = true;
                            else if (cellText === 'false') val = false;
                            else if (cellText === 'null') val = null;
                            else val = cellText;
                        }
                        updates.push({ path, value: val });
                    }
                });
            });
            if (updates.length > 0) this.activeModel.batchUpdateValues(updates);
        } catch (err) { }
    }

    deleteSelection() {
        const range = this.gridView.getSelectedPaths();
        if (range.length === 0 || !this.activeModel) return;
        const updates = [];
        range.flat().forEach(path => { if (path && path !== 'root') updates.push({ path, value: null }); });
        if (updates.length > 0) this.activeModel.batchUpdateValues(updates);
    }
}

new App();
