const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function openGame() {
    const html = fs.readFileSync('blackjack.html', 'utf8');
    const engine = fs.readFileSync('blackjack-engine.js', 'utf8');
    const moduleScript = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1]
        .replace(/import\s+[\s\S]*?from\s+["'][^"']+["'];/g, '');
    const elements = {};
    for (const id of ['pseudo', 'code', 'go', 'solo', 'login', 'game', 'err']) {
        elements[id] = {value: '', hidden: false, textContent: ''};
    }
    let markup = '', controls = {}, chips = [];
    Object.defineProperty(elements.game, 'innerHTML', {
        get: () => markup,
        set: value => {
            markup = value;
            controls = {};
            chips = [];
            for (const match of value.matchAll(/id="([^"]+)"/g)) controls[match[1]] = {textContent: ''};
            for (const match of value.matchAll(/class="chip c\d+" data-v="(\d+)"/g)) {
                chips.push({dataset: {v: match[1]}});
            }
        }
    });
    const document = {
        querySelector: selector => elements[selector.slice(1)] || controls[selector.slice(1)] || null,
        querySelectorAll: selector => selector === '.chip' ? chips : []
    };
    const backend = {room: null, listeners: []};
    const auth = {currentUser: {uid: 'online-player'}};
    const context = {document, localStorage: {}, location: {hash: '', href: 'https://example.test/', reload() {}},
        navigator: {clipboard: {writeText() {}}}, setInterval() {}, structuredClone, console,
        alert: message => { throw Error(message); }, initializeApp: () => ({}), getAuth: () => auth,
        getFirestore: () => ({}), signInAnonymously: async () => {}, doc: () => ({}),
        onSnapshot: (ref, callback) => {
            backend.listeners.push(callback);
            callback({data: () => structuredClone(backend.room)});
            return () => {};
        },
        runTransaction: async (db, callback) => {
            let next;
            await callback({
                get: async () => ({exists: () => !!backend.room, data: () => structuredClone(backend.room)}),
                set: (ref, data) => { next = structuredClone(data); }
            });
            if (next) {
                backend.room = next;
                backend.listeners.forEach(listener => listener({data: () => structuredClone(next)}));
            }
        }};
    vm.createContext(context);
    vm.runInContext(engine, context);
    vm.runInContext(moduleScript + '\nglobalThis.testUI = {getRoom: () => room, render};', context);
    return {html, elements, context, backend, get markup() { return markup; }, get controls() { return controls; },
        get chips() { return chips; }};
}

test('solo UI supports split, double and independent results', () => {
    const ui = openGame();
    assert.match(ui.html, /src="blackjack-engine\.js"/);
    assert.match(ui.html, /href="table\.css"/);
    ui.elements.pseudo.value = 'Alice';
    ui.elements.solo.onclick();
    const room = ui.context.testUI.getRoom();
    room.deck = [...Array(160).fill(1), 4, 0, 4, 7, 22, 9, 9];
    ui.chips[0].onclick();
    ui.controls.ok.onclick();
    assert.match(ui.markup, /Carte cachée/);
    assert.ok(ui.controls.split);
    assert.ok(ui.controls.surrender);
    ui.controls.split.onclick();
    assert.match(ui.markup, /MAIN 1/);
    assert.match(ui.markup, /MAIN 2/);
    assert.equal(ui.controls.surrender, undefined);
    ui.controls.db.onclick();
    assert.match(ui.markup, /Manche suivante/);
    assert.match(ui.markup, /Gagné/);
    ui.controls.nx.onclick();
    assert.match(ui.markup, /Choisissez votre mise/);
});

test('insurance is shown with a hidden dealer card and declined through UI', () => {
    const ui = openGame();
    ui.elements.solo.onclick();
    ui.context.testUI.getRoom().deck = [...Array(160).fill(1), 5, 6, 0, 8];
    ui.chips[0].onclick();
    ui.controls.ok.onclick();
    assert.match(ui.markup, /Assurance : faites votre choix/);
    assert.match(ui.markup, /Carte cachée/);
    assert.ok(ui.controls.insure);
    ui.controls.decline.onclick();
    assert.ok(ui.controls.hit);
    assert.equal(ui.controls.insure, undefined);
});

test('multiplayer names are escaped in both turn and seat displays', () => {
    const ui = openGame();
    ui.elements.solo.onclick();
    const room = ui.context.testUI.getRoom();
    room.order.push('other');
    room.players.other = ui.context.Blackjack.makePlayer('<img src=x>', 'play');
    room.phase = 'play';
    room.turn = 'other';
    ui.context.testUI.render();
    assert.doesNotMatch(ui.markup, /<img src=x>/);
    assert.match(ui.markup, /&lt;img src=x&gt;/);
});

test('online join and betting use the shared transactional engine', async () => {
    const ui = openGame();
    ui.elements.pseudo.value = 'Alice';
    ui.elements.code.value = 'TEST';
    await ui.elements.go.onclick();
    assert.equal(ui.backend.room.version, ui.context.Blackjack.VERSION);
    assert.match(ui.markup, /TABLE EN LIGNE/);
    ui.backend.room.deck = [...Array(160).fill(1), 7, 5, 9, 8];
    ui.chips[0].onclick();
    ui.controls.ok.onclick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(ui.backend.room.phase, 'play');
    assert.match(ui.markup, /Carte cachée/);
    assert.ok(ui.controls.hit);
});

test('joining an old room reports the incompatibility without changing it', async () => {
    const ui = openGame();
    ui.backend.room = {phase: 'bet'};
    ui.elements.pseudo.value = 'Alice';
    await ui.elements.go.onclick();
    assert.match(ui.elements.err.textContent, /anciennes règles/);
    assert.deepEqual(ui.backend.room, {phase: 'bet'});
});
