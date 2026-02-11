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
