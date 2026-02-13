export class ContextMenu {
    constructor() {
        this.menu = null;
        this._closeHandler = (e) => this.hide();
    }

    show(e, items) {
        this.hide();

        const menu = document.createElement('div');
        menu.className = 'context-menu';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;

        items.forEach(item => {
            if (item.separator) {
                const sep = document.createElement('div');
                sep.className = 'context-menu-separator';
                menu.appendChild(sep);
                return;
            }

            const div = document.createElement('div');
            div.className = 'context-menu-item';
            div.textContent = item.label;
            if (item.disabled) div.classList.add('disabled');

            div.onclick = (ev) => {
                ev.stopPropagation();
                if (!item.disabled && item.action) {
                    item.action();
                    this.hide();
                }
            };
            menu.appendChild(div);
        });

        document.body.appendChild(menu);
        this.menu = menu;

        // 次のクリックで閉じるようにする
        setTimeout(() => {
            window.addEventListener('click', this._closeHandler);
            window.addEventListener('contextmenu', this._closeHandler);
        }, 0);
    }

    hide() {
        if (this.menu) {
            this.menu.remove();
            this.menu = null;
            window.removeEventListener('click', this._closeHandler);
            window.removeEventListener('contextmenu', this._closeHandler);
        }
    }
}
