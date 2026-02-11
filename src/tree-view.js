export class TreeView {
    constructor(container, model) {
        this.container = container;
        this.model = model;
        this.expandedPaths = new Set(['root']);
        this.selectedPath = null;

        this.container.addEventListener('click', (e) => {
            const nodeEl = e.target.closest('.tree-node');
            if (!nodeEl) return;

            const path = nodeEl.dataset.path;
            if (e.target.classList.contains('toggle-icon')) {
                this.toggle(path);
            } else {
                this.select(path);
            }
        });

        this.container.addEventListener('dblclick', (e) => {
            const nodeEl = e.target.closest('.tree-node');
            if (!nodeEl) return;
            this.toggle(nodeEl.dataset.path);
        });
    }

    toggle(path) {
        if (this.expandedPaths.has(path)) {
            this.expandedPaths.delete(path);
        } else {
            this.expandedPaths.add(path);
        }
        this.render();
    }

    select(path) {
        if (this.selectedPath === path) return;

        // 以前の選択を解除
        const prevSelected = this.container.querySelector('.tree-node.selected');
        if (prevSelected) prevSelected.classList.remove('selected');

        this.selectedPath = path;

        // 新しい選択を適用
        const nextSelected = this.container.querySelector(`.tree-node[data-path="${CSS.escape(path)}"]`);
        if (nextSelected) nextSelected.classList.add('selected');

        this.model.setSelection(path);
    }

    render() {
        this.container.innerHTML = '';
        const rootData = this.model.getData();
        if (!rootData) return;

        this.renderNode(rootData, 'root', 'root', 0, this.container);
    }

    renderNode(data, name, path, depth, container) {
        const isObject = data !== null && typeof data === 'object';
        const isArray = Array.isArray(data);
        const hasChildren = isObject && Object.keys(data).length > 0;
        const isExpanded = this.expandedPaths.has(path);

        const nodeEl = document.createElement('div');
        nodeEl.className = `tree-node ${this.selectedPath === path ? 'selected' : ''}`;
        nodeEl.style.paddingLeft = `${depth * 16}px`;
        nodeEl.style.userSelect = 'none'; // テキスト選択を防止してダブルクリックしやすくする
        nodeEl.dataset.path = path;

        const toggle = document.createElement('span');
        toggle.className = 'toggle-icon';
        toggle.textContent = hasChildren ? (isExpanded ? '▼' : '▶') : ' ';
        nodeEl.appendChild(toggle);

        const label = document.createElement('span');
        let labelText = name;
        if (isArray) labelText += ` [${data.length}]`;
        else if (isObject) labelText += ` { }`;
        else labelText += `: ${data}`;

        label.textContent = labelText;
        nodeEl.appendChild(label);

        container.appendChild(nodeEl);

        if (hasChildren && isExpanded) {
            for (const key in data) {
                const childPath = isArray ? `${path}[${key}]` : `${path}.${key}`;
                this.renderNode(data[key], key, childPath, depth + 1, container);
            }
        }
    }
}
