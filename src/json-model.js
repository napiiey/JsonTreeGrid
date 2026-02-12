export class JsonModel extends EventTarget {
    constructor() {
        super();
        this.data = null;
        this.selectionPath = null;
    }

    setData(json) {
        this.data = json;
        this.dispatchEvent(new CustomEvent('dataChange'));
    }

    getData() {
        return this.data;
    }

    setSelection(path) {
        this.selectionPath = path;
        this.dispatchEvent(new CustomEvent('selectionChange', { detail: { path } }));
    }

    updateValue(path, value) {
        if (!path) return;

        const parts = this.parsePath(path);
        let current = this.data;

        for (let i = 0; i < parts.length - 1; i++) {
            current = current[parts[i]];
        }

        const lastKey = parts[parts.length - 1];

        // 型の推論と変換
        let convertedValue = value;
        const originalValue = current[lastKey];

        if (typeof originalValue === 'number') {
            convertedValue = Number(value);
        } else if (typeof originalValue === 'boolean') {
            convertedValue = value === 'true' || value === true;
        } else if (originalValue === null) {
            // nullの場合はそのままか、パースを試みる
        }

        current[lastKey] = convertedValue;
        this.dispatchEvent(new CustomEvent('dataChange'));
    }

    parsePath(path) {
        // 例: "root.users[0].name" -> ["users", 0, "name"]
        // 最初が "root" の場合は飛ばす
        const parts = path.split(/(?:\.|\b(?=\[)|(?<=\])\.)/);
        return parts
            .map(p => {
                if (p.startsWith('[') && p.endsWith(']')) {
                    return parseInt(p.slice(1, -1), 10);
                }
                return p;
            })
            .filter(p => p !== 'root');
    }

    getValueByPath(parts, root = this.data) {
        let current = root;
        for (const part of parts) {
            if (current === undefined || current === null) return undefined;
            current = current[part];
        }
        return current;
    }

    getParentAndKey(path) {
        const parts = this.parsePath(path);
        if (parts.length === 0) return { parent: null, key: 'root', fullPath: 'root' };

        const key = parts[parts.length - 1];
        const parentParts = parts.slice(0, -1);
        const parent = this.getValueByPath(parentParts);

        return { parent, key, parentParts };
    }

    moveArrayElement(path, fromIndex, toIndex) {
        const parts = this.parsePath(path);
        const array = this.getValueByPath(parts);
        if (Array.isArray(array)) {
            const [item] = array.splice(fromIndex, 1);
            array.splice(toIndex, 0, item);
            this.dispatchEvent(new CustomEvent('dataChange'));
        }
    }

    insertArrayElement(path, index) {
        const parts = this.parsePath(path);
        const array = this.getValueByPath(parts);
        if (Array.isArray(array)) {
            let newItem = null;
            if (array.length > 0) {
                const first = array[0];
                if (first !== null && typeof first === 'object' && !Array.isArray(first)) {
                    newItem = {};
                    Object.keys(first).forEach(key => {
                        const val = first[key];
                        if (typeof val === 'number') newItem[key] = 0;
                        else if (typeof val === 'boolean') newItem[key] = false;
                        else if (typeof val === 'string') newItem[key] = "";
                        else if (Array.isArray(val)) newItem[key] = [];
                        else if (val !== null && typeof val === 'object') newItem[key] = {};
                        else newItem[key] = null;
                    });
                } else if (Array.isArray(first)) {
                    newItem = [];
                } else if (typeof first === 'number') {
                    newItem = 0;
                } else if (typeof first === 'boolean') {
                    newItem = false;
                } else if (typeof first === 'string') {
                    newItem = "";
                } else {
                    newItem = null;
                }
            } else {
                newItem = {};
            }
            array.splice(index, 0, newItem);
            this.dispatchEvent(new CustomEvent('dataChange'));
        }
    }

    removeArrayElement(path, index) {
        const parts = this.parsePath(path);
        const array = this.getValueByPath(parts);
        if (Array.isArray(array)) {
            array.splice(index, 1);
            this.dispatchEvent(new CustomEvent('dataChange'));
        }
    }

    /**
     * オブジェクトのキー名を変更する。
     * baseParts で指定されたコンテキスト（配列または単一オブジェクト）内の
     * 各要素に対して、subPathParts を辿った先にある oldKey を newKey に変更する。
     */
    renameKey(baseParts, subPathParts, oldKey, newKey) {
        if (oldKey === newKey || !newKey) return;
        const rootTarget = this.getValueByPath(baseParts);
        if (!rootTarget) return;

        const renameOne = (obj) => {
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                if (Object.prototype.hasOwnProperty.call(obj, oldKey)) {
                    const keys = Object.keys(obj);
                    const newObj = {};
                    keys.forEach(k => {
                        if (k === oldKey) newObj[newKey] = obj[oldKey];
                        else newObj[k] = obj[k];
                    });
                    keys.forEach(k => delete obj[k]);
                    Object.assign(obj, newObj);
                }
            }
        };

        const traverseAndRename = (current, path) => {
            if (path.length === 0) {
                if (Array.isArray(current)) {
                    current.forEach(item => renameOne(item));
                } else {
                    renameOne(current);
                }
                return;
            }

            const first = path[0];
            const rest = path.slice(1);

            // インデックスの判定（数値または "[0]" 形式の文字列）
            let index = -1;
            if (typeof first === 'number') index = first;
            else if (typeof first === 'string' && first.startsWith('[') && first.endsWith(']')) {
                index = parseInt(first.slice(1, -1), 10);
            }

            if (index !== -1) {
                // インデックス（[0]等）に遭遇した場合、意図としては「その階層の全要素」を対象とする
                if (Array.isArray(current)) {
                    current.forEach(item => traverseAndRename(item, rest));
                } else if (current && current[index] !== undefined) {
                    traverseAndRename(current[index], rest);
                }
            } else {
                if (Array.isArray(current)) {
                    // 配列だがインデックス指定でない場合（例: コンテキスト自体が配列）、
                    // 全要素に対して同じパスで再帰を試みる
                    current.forEach(item => traverseAndRename(item, path));
                } else if (current && typeof current === 'object' && current[first] !== undefined) {
                    traverseAndRename(current[first], rest);
                }
            }
        };

        traverseAndRename(rootTarget, subPathParts);
        this.dispatchEvent(new CustomEvent('dataChange'));
    }

    /**
     * オブジェクト内のキーの順序を変更する
     * 同じ親を持つ兄弟キー同士でのみ移動可能
     */
    moveKey(parentPathParts, oldKey, newKey, insertAfter = false) {
        if (oldKey === newKey && !insertAfter) return; // 単純なリネーム目的のAPIではないが、ガード
        if (oldKey === newKey && insertAfter) return; // 同じ場所への移動は何もしない

        // 再帰的に適用する関数
        const reorderInObject = (obj) => {
            if (obj && typeof obj === 'object' && !Array.isArray(obj)) {
                if (Object.prototype.hasOwnProperty.call(obj, oldKey) && Object.prototype.hasOwnProperty.call(obj, newKey)) {
                    const keys = Object.keys(obj);
                    const oldIndex = keys.indexOf(oldKey);

                    // 先に削除
                    const item = keys.splice(oldIndex, 1)[0];

                    // 削除後の配列で新しいインデックスを検索
                    let newIndex = keys.indexOf(newKey);
                    if (newIndex === -1) {
                        // エラー回復: 元に戻す
                        keys.splice(oldIndex, 0, item);
                        return;
                    }

                    if (insertAfter) {
                        newIndex++;
                    }

                    keys.splice(newIndex, 0, item);

                    const newObj = {};
                    keys.forEach(k => {
                        newObj[k] = obj[k];
                    });

                    // 中身を入れ替える
                    Object.keys(obj).forEach(k => delete obj[k]);
                    Object.assign(obj, newObj);
                }
            }
        };

        const traverseAndReorder = (current, path) => {
            if (path.length === 0) {
                if (Array.isArray(current)) {
                    current.forEach(item => reorderInObject(item));
                } else {
                    reorderInObject(current);
                }
                return;
            }

            const first = path[0];
            const rest = path.slice(1);

            // インデックスの判定
            let index = -1;
            if (typeof first === 'number') index = first;
            else if (typeof first === 'string' && first.startsWith('[') && first.endsWith(']')) {
                index = parseInt(first.slice(1, -1), 10);
            }

            if (index !== -1) {
                if (Array.isArray(current)) {
                    current.forEach(item => traverseAndReorder(item, rest));
                } else if (current && current[index] !== undefined) {
                    traverseAndReorder(current[index], rest);
                }
            } else {
                if (Array.isArray(current)) {
                    current.forEach(item => traverseAndReorder(item, path));
                } else if (current && typeof current === 'object' && current[first] !== undefined) {
                    traverseAndReorder(current[first], rest);
                }
            }
        };

        traverseAndReorder(this.data, parentPathParts);
        this.dispatchEvent(new CustomEvent('dataChange'));
    }

    /**
     * 指定されたパスが含まれる最近接の配列コンテキストを取得する
     */
    getGridContext(path) {
        const parts = this.parsePath(path);
        const val = this.getValueByPath(parts);

        // 1. パス自体が配列である場合
        if (Array.isArray(val)) {
            return {
                rows: val,
                parentParts: parts,
                relativePath: [],
                isArray: true
            };
        }

        // 2. 親方向に遡って最近接の配列を探す
        for (let i = parts.length - 1; i >= 0; i--) {
            if (typeof parts[i] === 'number') {
                const arrayParts = parts.slice(0, i);
                const array = this.getValueByPath(arrayParts);
                if (Array.isArray(array)) {
                    return {
                        rows: array,
                        parentParts: arrayParts,
                        relativePath: parts.slice(i + 1),
                        isArray: true
                    };
                }
            }
        }

        // 3. 自分自身がオブジェクト（非配列）の場合、それを単一行として表示
        if (val !== null && typeof val === 'object') {
            return {
                rows: [val],
                parentParts: parts,
                relativePath: [],
                isArray: false
            };
        }

        // 4. プリミティブ等の場合は、親オブジェクト（またはルート）をコンテキストとして表示
        const pk = this.getParentAndKey(path);
        return {
            rows: pk.parent ? [pk.parent] : [this.data],
            parentParts: pk.parentParts || [],
            relativePath: [pk.key],
            isArray: false
        };
    }
}
