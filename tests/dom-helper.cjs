// 브라우저 없이 입력 이벤트와 생성한 화면의 연결을 검사한다.
class Node {
	constructor(tag) { this.tag = tag; this.children = []; this.listeners = {}; this.value = ''; this.checked = false; this.textContent = ''; }
	append(...children) { this.children.push(...children.filter(item => item != null)); }
	replaceChildren(...children) { this.children = []; this.append(...children); }
	addEventListener(name, fn) { (this.listeners[name] ??= []).push(fn); }
	setAttribute(key, value) { this[key] = String(value); }
	remove() {}
	removeAttribute(key) { delete this[key]; }
	focus() {}
	select() {}
	async emit(name) { for (const fn of this.listeners[name] ?? []) await fn({ target: this, stopPropagation() {} }); }
}
function el(tag, props, ...children) {
	const node = new Node(tag);
	for (const [key, value] of Object.entries(props ?? {})) {
		if (key === 'text') node.textContent = value;
		else if (key === 'class') node.className = value;
		else if (key.startsWith('on')) node.addEventListener(key.slice(2), value);
		else node.setAttribute(key, value);
	}
	node.append(...children);
	return node;
}
function all(node, predicate) { return [node, ...(node.children ?? []).flatMap(child => typeof child === 'object' ? all(child, () => true) : [])].filter(predicate); }
module.exports = { Node, el, all };
