import './style.css';
import { JsonModel } from './json-model.js';
import { TreeView } from './tree-view.js';
import { GridView } from './grid-view.js';

class App {
    constructor() {
        this.model = new JsonModel();
        this.treeView = new TreeView(document.getElementById('tree-container'), this.model);
        this.gridView = new GridView(document.getElementById('grid-container'), this.model);

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

        // ツールバーのイベント
        document.getElementById('open-btn').addEventListener('click', () => {
            this.openFile();
        });

        document.getElementById('save-btn').addEventListener('click', () => {
            this.saveFile();
        });

        // 初期データの読み込み（デモ用）
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
        this.model.setData(demoData);
    }

    async openFile() {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (file) {
                const text = await file.text();
                try {
                    const json = JSON.parse(text);
                    this.model.setData(json);
                    document.getElementById('file-info').textContent = file.name;
                } catch (err) {
                    alert('JSONのパースに失敗しました');
                }
            }
        };
        input.click();
    }

    saveFile() {
        const json = this.model.getData();
        const blob = new Blob([JSON.stringify(json, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = document.getElementById('file-info').textContent === '新規ファイル' ? 'data.json' : document.getElementById('file-info').textContent;
        a.click();
        URL.revokeObjectURL(url);
    }
}

new App();
