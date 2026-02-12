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
            'menu-redo': () => this.model.redo()
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

        // 4. ショートカットキー (Undo/Redo)
        document.addEventListener('keydown', (e) => {
            if (e.ctrlKey || e.metaKey) {
                if (e.key.toLowerCase() === 'z') {
                    e.preventDefault();
                    if (e.shiftKey) {
                        this.model.redo();
                    } else {
                        this.model.undo();
                    }
                } else if (e.key.toLowerCase() === 'y') {
                    e.preventDefault();
                    this.model.redo();
                }
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
}

new App();
