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

        // フラット化の開閉状態 (フルパス文字列をキーにする)
        this.collapsedPaths = new Set(); // オブジェクト用（デフォルト展開）
        this.expandedPaths = new Set();  // 配列用（デフォルト折りたたみ）

        // 行ドラッグ用の状態
        this.draggedRowIndex = null;
        this.dragOverRowIndex = null;

        // コンテキストメニュー用
        this.contextMenu = null;

        // 範囲選択用の状態
        this.selectionAnchor = null; // { rowIndex, colIndex }
        this.selectionFocus = null;  // { rowIndex, colIndex }
        this.isSelecting = false;

        // 仮想スクロール用の状態
        this.rowHeights = []; // キャッシュされた行の高さ
        this.defaultRowHeight = 22; // 推定行高さ
        this.bufferRows = 5; // 上下に余分に描画する行数
        this.scrollTop = 0;
        this.viewportHeight = 0;

        // 折り返し設定されたカラムID
        this.wrappedColumnIds = new Set();
        this.headerSelection = null; // { colId, pathParts }
        this.isHeaderSelecting = false;

        // 編集・選択のイベントは mousedown/dblclick で管理

        this.container.addEventListener('dblclick', (e) => {
            const cell = e.target.closest('.grid-cell');
            if (!cell) return;
            this.startEdit(cell, { append: true });
        });

        this.container.addEventListener('mousedown', (e) => this.handleMouseDown(e));
        window.addEventListener('mousemove', (e) => this.handleMouseMove(e));
        window.addEventListener('mouseup', (e) => this.handleMouseUp(e));

        // ポインターイベントによるドラッグ選択開始
        this.container.addEventListener('mouseover', (e) => {
            if (this.isSelecting) {
                const cell = e.target.closest('.grid-cell');
                const indexCell = e.target.closest('.grid-index');
                const th = e.target.closest('th');

                if (cell) {
                    this.selectionFocus = {
                        rowIndex: parseInt(cell.parentElement.dataset.index),
                        colIndex: parseInt(cell.dataset.colIndex)
                    };
                } else if (indexCell && indexCell.tagName === 'TD') {
                    const rowIndex = parseInt(indexCell.parentElement.dataset.index);
                    const table = indexCell.closest('.grid-table');
                    const colCount = table.querySelectorAll('colgroup col[data-col-id]').length;
                    this.selectionFocus = { rowIndex, colIndex: colCount - 1 };
                } else if (th && !isNaN(parseInt(th.dataset.colIndex))) {
                    const colIndex = parseInt(th.dataset.colIndex);
                    const colCount = parseInt(th.dataset.colCount);
                    const table = th.closest('.grid-table');
                    const rowCount = table.querySelectorAll('tbody .grid-row').length;
                    this.selectionFocus = { rowIndex: rowCount - 1, colIndex: colIndex + colCount - 1 };
                }
                this.updateSelectionUI();
            }
        });

        // ドラッグ＆ドロップ（行の並べ替え）
        this.container.addEventListener('dragstart', (e) => this.handleDragStart(e));
        this.container.addEventListener('dragover', (e) => this.handleDragOver(e));
        this.container.addEventListener('dragleave', (e) => this.handleDragLeave(e));
        this.container.addEventListener('drop', (e) => this.handleDrop(e));
        this.container.addEventListener('dragend', (e) => this.handleDragEnd(e));

        window.addEventListener('keydown', (e) => this.handleKeyDown(e));

        // スクロール時に仮想スクロールを更新
        this.scroller = this.container.parentElement;
        this.scroller.addEventListener('scroll', () => {
            if (!this.lastGridContext) return;
            this.scrollTop = this.scroller.scrollTop;
            this.updateVirtualRows();
        });

        // コンテナのサイズ変更時に表示範囲を再計算
        this.resizeObserver = new ResizeObserver(() => {
            if (this.lastGridContext) this.updateVirtualRows();
        });
        this.resizeObserver.observe(this.scroller);
    }

    setModel(model) {
        this.model = model;
        this.render();
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

        // --- 再帰的なカラム構造探索 ---
        const getFlattenedColumns = (items, currentPathParts = []) => {
            const structureMap = new Map(); // key -> { subKeys: Set, isArray: bool, isObject: bool }

            items.forEach(item => {
                if (item !== null && typeof item === 'object') {
                    Object.keys(item).forEach(k => {
                        if (!structureMap.has(k)) {
                            structureMap.set(k, { subKeys: new Set(), isArray: false, isObject: false });
                        }
                        const val = item[k];
                        const info = structureMap.get(k);
                        if (val !== null && typeof val === 'object') {
                            if (Array.isArray(val)) {
                                info.isArray = true;
                                val.forEach((_, i) => info.subKeys.add(`[${i}]`));
                            } else {
                                info.isObject = true;
                                Object.keys(val).forEach(sk => info.subKeys.add(sk));
                            }
                        }
                    });
                }
            });

            const defs = [];
            structureMap.forEach((info, key) => {
                const fullPathParts = [...currentPathParts, key];
                const fullPathStr = fullPathParts.join('.');

                const isCollapsible = info.isArray || info.isObject;
                let isExpanded = false;
                if (isCollapsible) {
                    const defaultExpanded = info.isObject && !info.isArray;
                    // デフォルト挙動 + 個別の上書き状態を確認
                    if (this.collapsedPaths.has(fullPathStr)) isExpanded = false;
                    else if (this.expandedPaths.has(fullPathStr)) isExpanded = true;
                    else isExpanded = defaultExpanded;
                }

                if (isExpanded && info.subKeys.size > 0) {
                    const subItems = items.map(it => it ? it[key] : undefined).filter(it => it !== undefined);
                    const subCols = getFlattenedColumns(subItems, fullPathParts);
                    subCols.forEach(sc => defs.push(sc));
                } else {
                    defs.push({
                        path: fullPathParts,
                        name: key,
                        isCollapsible,
                        isCollapsed: !isExpanded,
                        isArray: info.isArray,
                        // 各パスの型情報を保存しておく
                        pathInfoMap: new Map([[fullPathStr, { isArray: info.isArray, isObject: info.isObject }]])
                    });
                }
            });
            return defs;
        };

        // コンテキスト(rows)に対する相対的なカラム定義を取得
        let columnDefs = getFlattenedColumns(rows);
        if (columnDefs.length === 0) columnDefs = [{ path: ['value'], name: 'value', isCollapsible: false }];

        // カラムごとの最大値を計算（データバー用）および初期幅の計算
        const columnMaxMap = new Map();
        const colInitialWidths = new Map();
        columnDefs.forEach(colDef => {
            const colId = colDef.path.join('.');
            let max = -Infinity;
            let hasNumeric = false;

            // カラム名（ヘッダー）の長さから開始
            let maxLen = 0;
            const headerName = colDef.name;
            for (let i = 0; i < headerName.length; i++) {
                maxLen += headerName.charCodeAt(i) > 255 ? 2 : 1;
            }

            rows.forEach(rowData => {
                const val = this.model.getValueByPath(colDef.path, rowData);

                const num = parseFloat(val);
                if (!isNaN(num)) {
                    if (num > max) max = num;
                    hasNumeric = true;
                }

                if (val !== null && val !== undefined && (typeof val === 'string' || typeof val === 'number')) {
                    const s = String(val);
                    // 全角を2、半角を1として視覚的な長さを計算
                    let visualLen = 0;
                    for (let i = 0; i < s.length; i++) {
                        visualLen += s.charCodeAt(i) > 255 ? 2 : 1;
                    }
                    if (visualLen > maxLen) maxLen = visualLen;
                }
            });

            if (hasNumeric && max > 0) {
                columnMaxMap.set(colDef, max);
            }

            // 初期幅の計算 (60pxベース、内容に合わせて調整。自動計算時は最大400pxに制限)
            let finalWidth = this.columnWidths[colId];
            if (!finalWidth) {
                finalWidth = Math.min(400, Math.max(60, maxLen * 7 + 12));
            }
            colInitialWidths.set(colId, finalWidth);
        });

        this.columnMaxMap = columnMaxMap;
        this.columnDefs = columnDefs;
        this.lastGridContext = context;

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
            const colId = colDef.path.join('.');
            const width = colInitialWidths.get(colId);
            col.style.width = `${width}px`;
            col.dataset.colId = colId;
            colgroup.appendChild(col);
        });
        table.appendChild(colgroup);

        // テーブル全体の初期幅を設定
        let initialTableWidth = 40; // Index
        colInitialWidths.forEach(w => initialTableWidth += w);
        table.style.width = `${initialTableWidth}px`;

        // --- 多段ヘッダーの生成 ---
        const thead = document.createElement('thead');
        const maxDepth = columnDefs.reduce((m, c) => Math.max(m, c.path.length), 0);

        for (let d = 0; d < maxDepth; d++) {
            const tr = document.createElement('tr');

            if (d === 0) {
                const indexTh = document.createElement('th');
                indexTh.className = 'grid-index';
                indexTh.setAttribute('rowspan', maxDepth);
                tr.appendChild(indexTh);
            }

            for (let i = 0; i < columnDefs.length; i++) {
                const col = columnDefs[i];
                const segment = col.path[d];

                // depth d に到達していないパス（理論上ないはずだが安全策）
                if (segment === undefined) continue;

                // 前の列と同じグループかチェック
                let prevGroup = true;
                if (i === 0) prevGroup = false;
                else {
                    for (let step = 0; step <= d; step++) {
                        if (columnDefs[i - 1].path[step] !== col.path[step]) {
                            prevGroup = false;
                            break;
                        }
                    }
                }

                if (!prevGroup) {
                    // 新しいヘッダーセルを作成
                    const th = document.createElement('th');
                    const content = document.createElement('div');
                    content.className = 'th-content';
                    content.textContent = segment;

                    // ドラッグ可能にする (リネームと共存させるためハンドル以外をドラッグ領域とするか、ハンドルを追加するか)
                    // ここではヘッダー全体をドラッグ可能にするが、リサイズハンドルや入力中は除外する制御が必要
                    content.draggable = true;
                    content.ondragstart = (e) => {
                        // リサイズハンドル等を掴んでいる場合はドラッグしない
                        if (e.target.classList.contains('col-resize-handle') || e.target.tagName === 'INPUT') {
                            e.preventDefault();
                            return;
                        }
                        e.dataTransfer.setData('application/json', JSON.stringify({
                            path: col.path.slice(0, d + 1),
                            parentPath: col.path.slice(0, d),
                            key: segment
                        }));
                        e.dataTransfer.effectAllowed = 'move';
                        th.classList.add('dragging-col');
                    };

                    content.ondragover = (e) => {
                        e.preventDefault(); // ドロップ許可
                        // 親パスが一致する場合のみ許可
                        const data = document.querySelector('.dragging-col');
                        if (data) {
                            const rect = th.getBoundingClientRect();
                            const mid = rect.left + rect.width / 2;
                            if (e.clientX < mid) {
                                th.classList.add('header-drag-over-left');
                                th.classList.remove('header-drag-over-right');
                            } else {
                                th.classList.add('header-drag-over-right');
                                th.classList.remove('header-drag-over-left');
                            }
                            th.classList.remove('header-drag-over'); // 古いクラス削除
                            e.dataTransfer.dropEffect = 'move';
                        }
                    };

                    content.ondragleave = (e) => {
                        th.classList.remove('header-drag-over-left');
                        th.classList.remove('header-drag-over-right');
                    };

                    content.ondrop = (e) => {
                        e.preventDefault();
                        const isRight = th.classList.contains('header-drag-over-right');
                        th.classList.remove('header-drag-over-left');
                        th.classList.remove('header-drag-over-right');

                        const rawOpt = e.dataTransfer.getData('application/json');
                        if (!rawOpt) return;

                        try {
                            const srcData = JSON.parse(rawOpt);
                            const targetParentPath = col.path.slice(0, d);
                            const targetKey = segment;
                            const srcParentPath = srcData.parentPath;

                            if (JSON.stringify(srcParentPath) === JSON.stringify(targetParentPath)) {
                                // フルパス（ルートを含む）でモデルに渡す（getFlattenedColumnsが生成するpathはルートからの相対パス）
                                // ただし grid-view の col.path は getFlattenedColumns の fullPathParts。
                                // getFlattenedColumns の fullPathParts は 親の items 呼び出し時の currentPathParts に依存。
                                // GridView render 内:
                                // const context = this.model.getGridContext(this.selectedPath);
                                // const getFlattenedColumns = (items, currentPathParts = []) => ...
                                // ...
                                // let columnDefs = getFlattenedColumns(rows);
                                // この時 currentPathParts はデフォルト [] 。
                                // つまり col.path は rows 内の 相対パス。
                                // 一方 moveKey は root からのパスを期待している。
                                // よって parentParts (context.parentParts) をプレフィックスとして付与する必要がある。
                                // ... と思いきや、 getGridContext は rows を返す。
                                // rows が array の場合、 items = rows. 
                                // columnDefs の path には root からの情報は含まれていない (selectedPath配下の相対パス)

                                // 正: moveKey に渡すべきは root からの path。
                                // context.parentParts + srcParentPath

                                const fullParentPath = [...parentParts, ...srcParentPath];
                                this.model.moveKey(fullParentPath, srcData.key, targetKey, isRight);
                            }
                        } catch (err) {
                            console.error(err);
                        }
                    };

                    content.ondragend = () => {
                        document.querySelectorAll('.dragging-col').forEach(el => el.classList.remove('dragging-col'));
                        document.querySelectorAll('.header-drag-over-left').forEach(el => el.classList.remove('header-drag-over-left'));
                        document.querySelectorAll('.header-drag-over-right').forEach(el => el.classList.remove('header-drag-over-right'));
                    };

                    th.appendChild(content);

                    // ダブルクリックで名前変更
                    if (!segment.startsWith('[')) { // 配列インデックスは除外
                        th.ondblclick = (e) => {
                            e.stopPropagation();
                            this.startHeaderEdit(th, segment, parentParts, col.path.slice(0, d));
                        };
                        th.oncontextmenu = (e) => this.showHeaderContextMenu(e, segment, parentParts, col.path.slice(0, d));
                    }

                    // colspan の計算
                    let colspan = 1;
                    for (let j = i + 1; j < columnDefs.length; j++) {
                        let match = true;
                        for (let step = 0; step <= d; step++) {
                            if (columnDefs[j].path[step] !== col.path[step]) {
                                match = false;
                                break;
                            }
                        }
                        if (match) colspan++;
                        else break;
                    }
                    if (colspan > 1) th.setAttribute('colspan', colspan);
                    th.dataset.colIndex = i;
                    th.dataset.colCount = colspan;

                    // rowspan の計算 (これがパスの最後のセグメントなら下まで伸ばす)
                    if (d === col.path.length - 1) {
                        const rs = maxDepth - d;
                        if (rs > 1) th.setAttribute('rowspan', rs);

                        // リサイズハンドルは末端のセルに付ける
                        const colId = col.path.join('.');
                        const handle = document.createElement('div');
                        handle.className = 'col-resize-handle';
                        handle.dataset.col = colId;
                        th.dataset.colId = colId;
                        th.appendChild(handle);
                    }

                    // 開閉ボタンの追加
                    const fullPathStr = col.path.slice(0, d + 1).join('.');
                    const toggle = document.createElement('span');
                    toggle.className = 'grid-toggle';

                    if (col.isCollapsible && d === col.path.length - 1) {
                        // リーフ（折りたたまれている状態）
                        toggle.textContent = '▾';
                        toggle.onclick = (e) => {
                            e.stopPropagation();
                            if (col.isArray) {
                                this.expandedPaths.add(fullPathStr);
                            } else {
                                this.collapsedPaths.delete(fullPathStr);
                            }
                            this.render();
                        };
                        th.appendChild(toggle);
                    } else if (d < col.path.length - 1) {
                        // 中間ノード（展開されている状態）
                        toggle.textContent = '▴';
                        toggle.onclick = (e) => {
                            e.stopPropagation();
                            // 配列かオブジェクトかの判定
                            // セグメントが [0] 形式、またはパス自体が配列として管理されている場合
                            const isArrayNode = segment.startsWith('[') || this.expandedPaths.has(fullPathStr);

                            if (isArrayNode) {
                                this.expandedPaths.delete(fullPathStr);
                            } else {
                                this.collapsedPaths.add(fullPathStr);
                            }
                            this.render();
                        };
                        th.appendChild(toggle);
                    }

                    // スタイル
                    const hClass = (segment.toLowerCase().includes('name') || segment.toLowerCase().includes('id')) ? 'col-name' :
                        (segment.toLowerCase().includes('stats') || segment.toLowerCase().includes('val')) ? 'col-val' : '';
                    if (hClass) th.classList.add(hClass);


                    // sticky top の動的計算
                    th.style.top = `${d * 23}px`;

                    tr.appendChild(th);
                }
            }
            thead.appendChild(tr);
        }
        table.appendChild(thead);
        this.container.appendChild(table);

        // ボディ（まずは空で作成し、updateVirtualRowsで中身を埋める）
        const tbody = document.createElement('tbody');
        table.appendChild(tbody);

        this.updateVirtualRows();
    }

    getColorClass(colName) {
        const c = colName.toLowerCase();
        if (c.includes('hp')) return 'bar-green';
        if (c.includes('atk')) return 'bar-red';
        if (c.includes('int')) return 'bar-blue';
        if (c.includes('def')) return 'bar-yellow';
        return 'bar-grey';
    }

    updateVirtualRows() {
        if (!this.lastGridContext) return;
        this.scrollTop = this.scroller.scrollTop;
        const { rows } = this.lastGridContext;
        const table = this.container.querySelector('.grid-table');
        if (!table) return;
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const totalRows = rows.length;
        if (this.rowHeights.length !== totalRows) {
            this.rowHeights = new Array(totalRows).fill(this.defaultRowHeight);
        }

        // 累積高さの計算
        const rowOffsets = new Array(totalRows + 1).fill(0);
        for (let i = 0; i < totalRows; i++) {
            rowOffsets[i + 1] = rowOffsets[i] + this.rowHeights[i];
        }
        const totalHeight = rowOffsets[totalRows];

        // 表示範囲の特定
        const viewportHeight = this.scroller.clientHeight;
        const startY = this.scrollTop;
        const endY = startY + viewportHeight;

        let startIndex = 0;
        while (startIndex < totalRows && rowOffsets[startIndex + 1] < startY) {
            startIndex++;
        }
        startIndex = Math.max(0, startIndex - this.bufferRows);

        let endIndex = startIndex;
        while (endIndex < totalRows && rowOffsets[endIndex] < endY) {
            endIndex++;
        }
        endIndex = Math.min(totalRows - 1, endIndex + this.bufferRows);

        // レンダリング
        tbody.innerHTML = '';

        if (startIndex > 0) {
            const topSpacer = document.createElement('tr');
            const td = document.createElement('td');
            td.setAttribute('colspan', this.columnDefs.length + 1);
            td.style.height = `${rowOffsets[startIndex]}px`;
            td.style.padding = '0';
            td.style.border = 'none';
            topSpacer.appendChild(td);
            tbody.appendChild(topSpacer);
        }

        for (let i = startIndex; i <= endIndex; i++) {
            const tr = this.createRowElement(rows[i], i);
            tbody.appendChild(tr);
        }

        if (endIndex < totalRows - 1) {
            const bottomSpacer = document.createElement('tr');
            const td = document.createElement('td');
            td.setAttribute('colspan', this.columnDefs.length + 1);
            td.style.height = `${totalHeight - rowOffsets[endIndex + 1]}px`;
            td.style.padding = '0';
            td.style.border = 'none';
            bottomSpacer.appendChild(td);
            tbody.appendChild(bottomSpacer);
        }

        this.updateSelectionUI();

        // 実際の高さを計測してキャッシュを修正
        requestAnimationFrame(() => {
            let changed = false;
            const renderedRows = tbody.querySelectorAll('.grid-row');
            renderedRows.forEach(tr => {
                const idx = parseInt(tr.dataset.index);
                const actualH = tr.offsetHeight;
                if (Math.abs(this.rowHeights[idx] - actualH) > 0.5) {
                    this.rowHeights[idx] = actualH;
                    changed = true;
                }
            });
            // 高さが変わっていたら再描画（ただし無限ループ防止のため閾値を設ける）
            if (changed) {
                // スクロールバーがガタつかないよう、スペーサーのみを後から修正する手法もあるが、
                // 今回はシンプルに再描画を予約する
                // this.updateVirtualRows(); // 慎重に
            }
        });
    }

    createRowElement(rowData, rowIndex) {
        const { isArray, parentParts } = this.lastGridContext;
        const tr = document.createElement('tr');
        tr.className = 'grid-row';
        tr.dataset.index = rowIndex;

        const indexTd = document.createElement('td');
        indexTd.textContent = rowIndex;
        indexTd.className = 'grid-index';
        indexTd.draggable = true;
        if (isArray) {
            indexTd.oncontextmenu = (e) => this.showIndexContextMenu(e, rowIndex, parentParts);
        }
        tr.appendChild(indexTd);

        this.columnDefs.forEach((colDef, colIndex) => {
            const td = document.createElement('td');
            td.className = 'grid-cell';
            td.dataset.colIndex = colIndex;

            const colId = colDef.path.join('.');
            if (this.wrappedColumnIds.has(colId)) {
                td.classList.add('cell-wrap');
            }

            const val = this.model.getValueByPath(colDef.path, rowData);

            if (val !== null && typeof val === 'object') {
                td.textContent = JSON.stringify(val);
                td.title = JSON.stringify(val, null, 2);
                td.classList.add('cell-object');
            } else {
                td.textContent = val !== undefined ? val : '';
            }

            // データバー
            const num = parseFloat(val);
            const max = this.columnMaxMap.get(colDef);
            if (max !== undefined && !isNaN(num)) {
                const percent = Math.min(100, Math.max(0, (num / max) * 100));
                const bar = document.createElement('div');
                bar.className = `data-bar ${this.getColorClass(colDef.name)}`;
                bar.style.width = `${percent}%`;
                td.classList.add('has-bar');
                td.appendChild(bar);
            }

            // パス
            let cellPath = this.partsToPath(parentParts);
            if (isArray) {
                cellPath += `[${rowIndex}]`;
            }
            colDef.path.forEach(p => {
                if (p.startsWith('[')) cellPath += p;
                else cellPath += (cellPath ? '.' : '') + p;
            });
            td.dataset.path = cellPath;
            if (this.selectionAnchor && this.selectionFocus) {
                const r1 = Math.min(this.selectionAnchor.rowIndex, this.selectionFocus.rowIndex);
                const r2 = Math.max(this.selectionAnchor.rowIndex, this.selectionFocus.rowIndex);
                const c1 = Math.min(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);
                const c2 = Math.max(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);

                const inRange = (rowIndex >= r1 && rowIndex <= r2 && colIndex >= c1 && colIndex <= c2);
                const isAnchor = (rowIndex === this.selectionAnchor.rowIndex && colIndex === this.selectionAnchor.colIndex);

                if (inRange) td.classList.add('range-selected');
                if (isAnchor) td.classList.add('selected');
            }

            tr.appendChild(td);
        });
        return tr;
    }

    // --- マウスイベント (リサイズ / 範囲選択) ---
    handleMouseDown(e) {
        if (e.target.classList.contains('col-resize-handle')) {
            this.resizingCol = e.target.dataset.col;
            this.startX = e.clientX;
            const th = e.target.parentElement;
            this.startWidth = th.offsetWidth;
            document.body.style.cursor = 'col-resize';
            e.preventDefault();
            return;
        }

        const cell = e.target.closest('.grid-cell');
        const indexCell = e.target.closest('.grid-index');
        const th = e.target.closest('th');

        if (indexCell && indexCell.tagName === 'TD') {
            // 行番号をクリックした場合
            const rowIndex = parseInt(indexCell.parentElement.dataset.index);
            const table = indexCell.closest('.grid-table');
            const colCount = table.querySelectorAll('colgroup col[data-col-id]').length;

            if (e.shiftKey && this.selectionAnchor) {
                this.selectionFocus = { rowIndex, colIndex: colCount - 1 };
            } else {
                this.selectionAnchor = { rowIndex, colIndex: 0 };
                this.selectionFocus = { rowIndex, colIndex: colCount - 1 };
                this.isSelecting = true;
            }
            this.updateSelectionUI();
            e.preventDefault();
            return;
        }

        if (th && !e.target.classList.contains('col-resize-handle') && !e.target.classList.contains('grid-toggle')) {
            // 見出しをクリックした場合
            const colIndex = parseInt(th.dataset.colIndex);
            const colCount = parseInt(th.dataset.colCount);
            if (!isNaN(colIndex)) {
                const table = th.closest('.grid-table');
                const rowCount = table.querySelectorAll('tbody .grid-row').length;

                if (e.shiftKey && this.selectionAnchor) {
                    this.selectionFocus = { rowIndex: rowCount - 1, colIndex: colIndex + colCount - 1 };
                } else {
                    this.selectionAnchor = { rowIndex: 0, colIndex: colIndex };
                    this.selectionFocus = { rowIndex: rowCount - 1, colIndex: colIndex + colCount - 1 };
                    this.isSelecting = true;
                }

                // ヘッダー選択
                this.isHeaderSelecting = true;
                const colDef = this.columnDefs[colIndex];
                if (colDef) {
                    this.headerSelection = {
                        colId: colDef.path.join('.'),
                        name: colDef.name,
                        path: colDef.path
                    };
                }

                this.updateSelectionUI();
                e.preventDefault();
                return;
            }
        }

        if (cell) {
            // 入力中などの場合はデフォルト挙動を許容
            if (e.target.tagName === 'INPUT' || e.target.contentEditable === 'true') return;

            e.preventDefault(); // テキスト選択などを防ぐ
            this.isHeaderSelecting = false;
            const rowIndex = parseInt(cell.parentElement.dataset.index);
            const colIndex = parseInt(cell.dataset.colIndex);

            if (e.shiftKey && this.selectionAnchor) {
                // Shiftキー押下時は範囲を広げる
                this.selectionFocus = { rowIndex, colIndex };
            } else {
                // 通常クリック時は新しい範囲を開始
                this.selectionAnchor = { rowIndex, colIndex };
                this.selectionFocus = { rowIndex, colIndex };
                this.isSelecting = true;

                // 単一パスの選択も同期
                this.selectedPath = cell.dataset.path;
                this.model.setSelection(this.selectedPath);
            }
            this.updateSelectionUI();
        }
    }

    toggleWrapSelection() {
        if (!this.selectionAnchor || !this.selectionFocus) return;

        const c1 = Math.min(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);
        const c2 = Math.max(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);

        // 最初の選択列の状態を見て、反転させる（トグルのため）
        const firstColId = this.columnDefs[c1]?.path.join('.');
        const shouldWrap = firstColId ? !this.wrappedColumnIds.has(firstColId) : true;

        for (let i = c1; i <= c2; i++) {
            const colId = this.columnDefs[i]?.path.join('.');
            if (colId) {
                if (shouldWrap) this.wrappedColumnIds.add(colId);
                else this.wrappedColumnIds.delete(colId);
            }
        }
        // 仮想スクロールのキャッシュ高さをリセットして再計算を促す
        this.rowHeights = [];
        this.updateVirtualRows();
        this.render(); // ヘッダー等再描画を含めるため
        this.model.dispatchEvent(new CustomEvent('selectionChange', { detail: { path: this.selectedPath } }));
    }

    isSelectionWrapped() {
        if (!this.selectionAnchor) return false;
        const colId = this.columnDefs[this.selectionAnchor.colIndex]?.path.join('.');
        return this.wrappedColumnIds.has(colId);
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
        this.isSelecting = false;
    }

    updateSelectionUI() {
        if (!this.selectionAnchor || !this.selectionFocus) return;

        const r1 = Math.min(this.selectionAnchor.rowIndex, this.selectionFocus.rowIndex);
        const r2 = Math.max(this.selectionAnchor.rowIndex, this.selectionFocus.rowIndex);
        const c1 = Math.min(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);
        const c2 = Math.max(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);

        this.container.querySelectorAll('.grid-cell').forEach(td => {
            const r = parseInt(td.parentElement.dataset.index);
            const c = parseInt(td.dataset.colIndex);

            const inRange = (r >= r1 && r <= r2 && c >= c1 && c <= c2);
            td.classList.toggle('range-selected', inRange);
            td.classList.toggle('selected', r === this.selectionAnchor.rowIndex && c === this.selectionAnchor.colIndex);
        });

        // アクティブな項目の通知
        if (this.isHeaderSelecting && this.headerSelection) {
            this.model.dispatchEvent(new CustomEvent('selectionChange', {
                detail: {
                    path: this.selectedPath,
                    header: this.headerSelection,
                    type: 'key'
                }
            }));
        } else {
            const activeCell = this.container.querySelector(`.grid-row[data-index="${this.selectionAnchor.rowIndex}"] .grid-cell[data-col-index="${this.selectionAnchor.colIndex}"]`);
            this.headerSelection = null;

            if (activeCell && activeCell.dataset.path !== this.selectedPath) {
                this.selectedPath = activeCell.dataset.path;
                this.model.setSelection(this.selectedPath);
            } else {
                this.model.dispatchEvent(new CustomEvent('selectionChange', {
                    detail: {
                        path: this.selectedPath,
                        type: 'value'
                    }
                }));
            }
        }
    }

    // --- 行の並べ替え (Drag & Drop) ---
    handleDragStart(e) {
        // インデックス列からドラッグが開始されたか確認
        if (!e.target.closest('.grid-index')) {
            return;
        }

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
        if (index === this.draggedRowIndex) {
            this.container.querySelectorAll('.grid-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
            return;
        }

        const rect = tr.getBoundingClientRect();
        const midY = rect.top + rect.height / 2;
        const isBottom = e.clientY > midY;

        this.container.querySelectorAll('.grid-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'));
        tr.classList.add(isBottom ? 'drag-over-bottom' : 'drag-over-top');
    }

    handleDragLeave(e) {
        const tr = e.target.closest('.grid-row');
        if (tr) tr.classList.remove('drag-over-top', 'drag-over-bottom');
    }

    handleDrop(e) {
        e.preventDefault();
        const tr = e.target.closest('.grid-row');
        if (!tr || this.draggedRowIndex === null) return;

        const isBottom = tr.classList.contains('drag-over-bottom');
        let toIndex = parseInt(tr.dataset.index);
        const fromIndex = this.draggedRowIndex;

        // 下側にドロップする場合、挿入位置は +1
        if (isBottom) {
            toIndex++;
        }

        // 自分の後ろに移動する場合、splice(from, 1)した後にインデックスがズレるのを補正
        if (fromIndex < toIndex) {
            toIndex--;
        }

        if (fromIndex !== toIndex) {
            const context = this.model.getGridContext(this.selectedPath);
            const arrayPath = this.partsToPath(context.parentParts);
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
            r.classList.remove('dragging', 'drag-over-top', 'drag-over-bottom');
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
        const rowIndex = parseInt(cell.parentElement.dataset.index);
        const colIndex = parseInt(cell.dataset.colIndex);
        this.selectionAnchor = { rowIndex, colIndex };
        this.selectionFocus = { rowIndex, colIndex };
        this.updateSelectionUI();
    }

    getSelectedPaths() {
        if (!this.selectionAnchor || !this.selectionFocus || !this.lastGridContext) return [];
        const { rows, isArray, parentParts } = this.lastGridContext;

        const r1 = Math.min(this.selectionAnchor.rowIndex, this.selectionFocus.rowIndex);
        const r2 = Math.max(this.selectionAnchor.rowIndex, this.selectionFocus.rowIndex);
        const c1 = Math.min(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);
        const c2 = Math.max(this.selectionAnchor.colIndex, this.selectionFocus.colIndex);

        const range = [];
        for (let r = r1; r <= r2; r++) {
            const row = [];
            for (let c = c1; c <= c2; c++) {
                const colDef = this.columnDefs[c];
                if (!colDef) {
                    row.push(null);
                    continue;
                }

                let cellPath = this.partsToPath(parentParts);
                if (isArray) {
                    cellPath += `[${r}]`;
                }
                colDef.path.forEach(p => {
                    if (p.startsWith('[')) cellPath += p;
                    else cellPath += (cellPath ? '.' : '') + p;
                });
                row.push(cellPath);
            }
            range.push(row);
        }
        return range;
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

        // フォーカス直後のブラウザのデフォルト挙動を回避するため、次のフレームでカーソル位置を調整
        requestAnimationFrame(() => {
            if (options.append || options.initialValue !== undefined) {
                const len = input.value.length;
                input.setSelectionRange(len, len);
            } else {
                input.select();
            }
        });

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

        const activeCell = this.container.querySelector('.grid-cell.selected');
        if (!activeCell || !this.selectionAnchor || !this.selectionFocus) return;

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
        let nextRow = this.selectionFocus.rowIndex;
        let nextCol = this.selectionFocus.colIndex;

        if (e.key === 'ArrowRight') nextCol++;
        else if (e.key === 'ArrowLeft') nextCol--;
        else if (e.key === 'ArrowDown') nextRow++;
        else if (e.key === 'ArrowUp') nextRow--;
        else return;

        // 範囲外チェック
        const rows = this.container.querySelectorAll('.grid-row');
        const maxRow = rows.length - 1;
        const maxCol = rows[0].querySelectorAll('.grid-cell').length - 1;

        nextRow = Math.max(0, Math.min(maxRow, nextRow));
        nextCol = Math.max(0, Math.min(maxCol, nextCol));

        if (e.shiftKey) {
            this.selectionFocus = { rowIndex: nextRow, colIndex: nextCol };
        } else {
            this.selectionAnchor = { rowIndex: nextRow, colIndex: nextCol };
            this.selectionFocus = { rowIndex: nextRow, colIndex: nextCol };
        }

        this.updateSelectionUI();

        // スクロール追従
        const targetCell = this.container.querySelector(`.grid-row[data-index="${nextRow}"] .grid-cell[data-col-index="${nextCol}"]`);
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
                this.model.renameKey(baseParts, subPathParts, oldKey, newKey);
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
                    const arrayPath = this.partsToPath(parentParts);
                    this.model.insertArrayElement(arrayPath, rowIndex);
                }
            },
            {
                label: '下に1行挿入',
                action: () => {
                    const arrayPath = this.partsToPath(parentParts);
                    this.model.insertArrayElement(arrayPath, rowIndex + 1);
                }
            },
            {
                label: 'この行を削除',
                action: () => {
                    const arrayPath = this.partsToPath(parentParts);
                    this.model.removeArrayElement(arrayPath, rowIndex);
                }
            }
        ];
        this.showContextMenu(e, items);
    }

    showHeaderContextMenu(e, key, parentParts, subPathParts) {
        e.preventDefault();
        e.stopPropagation();
        const items = [
            {
                label: '左に列を挿入',
                action: () => {
                    const fullParentPath = [...parentParts, ...subPathParts];
                    this.model.insertKey(fullParentPath, key, false);
                }
            },
            {
                label: '右に列を挿入',
                action: () => {
                    const fullParentPath = [...parentParts, ...subPathParts];
                    this.model.insertKey(fullParentPath, key, true);
                }
            },
            {
                label: 'この列を削除',
                action: () => {
                    const fullParentPath = [...parentParts, ...subPathParts];
                    this.model.removeKey(fullParentPath, key);
                }
            }
        ];
        this.showContextMenu(e, items);
    }

    showContextMenu(e, items) {
        this.removeContextMenu();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;

        items.forEach(item => {
            const div = document.createElement('div');
            div.className = 'context-menu-item';
            div.textContent = item.label;
            div.onclick = (ev) => {
                ev.stopPropagation();
                item.action();
                this.removeContextMenu();
            };
            menu.appendChild(div);
        });

        document.body.appendChild(menu);
        this.contextMenu = menu;

        const closeMenu = () => {
            this.removeContextMenu();
            window.removeEventListener('click', closeMenu);
            window.removeEventListener('contextmenu', closeMenu);
        };
        setTimeout(() => {
            window.addEventListener('click', closeMenu);
            window.addEventListener('contextmenu', closeMenu);
        }, 0);
    }

    removeContextMenu() {
        if (this.contextMenu) {
            this.contextMenu.remove();
            this.contextMenu = null;
        }
    }
}
