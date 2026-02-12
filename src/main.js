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
            'menu-cut': () => this.cutSelection(),
            'menu-copy': () => this.copySelection(),
            'menu-paste': () => this.pasteSelection(),
            'menu-delete': () => this.deleteSelection()
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
        this.newFile(true); // デモデータをセット
    }

    closeAllMenus() {
        document.querySelectorAll('.menu-group.active').forEach(g => g.classList.remove('active'));
    }

    newFile(isInitial = false) {
        const defaultData = {
            project: "New Project",
            version: 1.0,
            data: []
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
        } catch (err) {
            console.error(err);
            alert('保存に失敗しました。権限が拒否された可能性があります。');
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
        const path = this.model.selectionPath;
        if (!path || path === 'root') return;
        const parts = this.model.parsePath(path);
        const val = this.model.getValueByPath(parts);
        const text = (val !== null && typeof val === 'object') ? JSON.stringify(val, null, 2) : String(val);
        await navigator.clipboard.writeText(text);
    }

    async cutSelection() {
        await this.copySelection();
        this.deleteSelection();
    }

    async pasteSelection() {
        const path = this.model.selectionPath;
        if (!path || path === 'root') return;
        try {
            const text = await navigator.clipboard.readText();
            let val;
            try {
                val = JSON.parse(text);
            } catch {
                if (!isNaN(text) && text.trim() !== '') {
                    val = Number(text);
                } else if (text === 'true') {
                    val = true;
                } else if (text === 'false') {
                    val = false;
                } else if (text === 'null') {
                    val = null;
                } else {
                    val = text;
                }
            }
            this.model.updateValue(path, val);
        } catch (err) {
            console.error('Paste failed', err);
        }
    }

    deleteSelection() {
        const path = this.model.selectionPath;
        if (!path || path === 'root') return;
        this.model.updateValue(path, null);
    }
}

new App();
