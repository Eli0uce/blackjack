const test = require('node:test');
const assert = require('node:assert/strict');
require('../blackjack-engine.js');

const B = globalThis.Blackjack;
const card = (rank, suit = 0) => suit * 13 + rank;

function roomWithPlayers(...ids) {
    const d = B.makeRoom();
    for (const id of ids) {
        d.order.push(id);
        d.players[id] = B.makePlayer(id, 'bet');
    }
    return d;
}

function setDraws(d, ...cards) {
    d.deck = [...Array(160).fill(card(1)), ...cards.reverse()];
}

test('aces are counted as 1 or 11, including multiple aces', () => {
    assert.equal(B.value([card(0), card(0), card(8)]), 21);
    assert.equal(B.value([card(0), card(0), card(9), card(9)]), 22);
});

test('natural blackjack pays 3:2 without rounding', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(0), card(8), card(12), card(6));
    B.bet(d, 'a', 11);
    assert.equal(d.phase, 'done');
    assert.equal(d.players.a.chips, 1016.5);
    assert.equal(d.players.a.hands[0].res, 'Blackjack !');
});

test('dealer blackjack is checked before player actions, with a natural push', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(0), card(9), card(12), card(0));
    B.bet(d, 'a', 20);
    assert.equal(d.phase, 'done');
    assert.equal(d.players.a.chips, 1000);
    assert.equal(d.players.a.hands[0].res, 'Égalité');
    assert.equal(B.action(d, 'a', 'hit'), false);
});

test('insurance is offered before the dealer peeks and pays 2:1 on blackjack', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(8), card(0), card(6), card(12));
    B.bet(d, 'a', 20);
    assert.equal(d.phase, 'insurance');
    assert.equal(B.action(d, 'a', 'hit'), false);
    B.insurance(d, 'a', true);
    assert.equal(d.phase, 'done');
    assert.equal(d.players.a.chips, 1000);
    assert.equal(d.players.a.hands[0].res, 'Perdu');
});

test('insurance loses when dealer has no blackjack and cannot exceed available chips', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(8), card(0), card(6), card(5));
    B.bet(d, 'a', 1000);
    assert.equal(B.insurance(d, 'a', true), false);
    B.insurance(d, 'a', false);
    assert.equal(d.phase, 'play');
    assert.equal(d.players.a.chips, 0);
    assert.equal(d.players.a.insurance, 0);
});

test('all players must decide insurance before play and timeout declines remaining choices', () => {
    const d = roomWithPlayers('a', 'b');
    setDraws(d, card(7), card(8), card(0), card(6), card(5), card(5));
    B.bet(d, 'a', 20);
    B.bet(d, 'b', 20);
    B.insurance(d, 'a', true);
    assert.equal(d.phase, 'insurance');
    assert.equal(B.force(d), false);
    d.turnAt -= 20001;
    B.force(d);
    assert.equal(d.phase, 'play');
    assert.equal(d.players.a.insurance, 10);
    assert.equal(d.players.b.insurance, 0);
});

test('dealer stands on soft 17 and ties return the wager', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(9), card(0), card(6), card(5));
    B.bet(d, 'a', 20);
    B.insurance(d, 'a', false);
    B.action(d, 'a', 'stand');
    assert.equal(d.dealer.length, 2);
    assert.equal(d.players.a.hands[0].res, 'Égalité');
    assert.equal(d.players.a.chips, 1000);
});

test('dealer draws below 17 and loses on bust', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(9), card(9), card(7), card(5), card(9));
    B.bet(d, 'a', 20);
    B.action(d, 'a', 'stand');
    assert.equal(d.players.a.hands[0].res, 'Gagné');
    assert.equal(d.players.a.chips, 1020);
});

test('double deducts a second wager, draws exactly once, and ends the hand', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(4), card(9), card(5), card(7), card(9));
    B.bet(d, 'a', 20);
    B.action(d, 'a', 'double');
    assert.equal(d.phase, 'done');
    assert.equal(d.players.a.hands[0].cards.length, 3);
    assert.equal(d.players.a.hands[0].bet, 40);
    assert.equal(d.players.a.chips, 1040);
});

test('surrender returns exactly half after the dealer peek', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(9), card(9), card(5), card(7));
    B.bet(d, 'a', 11);
    B.action(d, 'a', 'surrender');
    assert.equal(d.phase, 'done');
    assert.equal(d.players.a.chips, 994.5);
    assert.equal(d.players.a.hands[0].res, 'Abandon');
});

test('split hands play and settle independently; a split 21 is not a natural', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(9), card(9), card(9, 1), card(7), card(4), card(0), card(4));
    B.bet(d, 'a', 20);
    B.action(d, 'a', 'split');
    assert.equal(d.players.a.hands.length, 2);
    assert.equal(d.players.a.chips, 960);
    assert.equal(B.action(d, 'a', 'surrender'), false);
    B.action(d, 'a', 'double');
    assert.equal(d.phase, 'done');
    assert.equal(d.players.a.hands[1].res, 'Gagné');
    assert.equal(d.players.a.chips, 1060);
});

test('split aces receive one card each and cannot become natural blackjack', () => {
    const d = roomWithPlayers('a');
    setDraws(d, card(0), card(9), card(0, 1), card(7), card(9), card(8));
    B.bet(d, 'a', 20);
    B.action(d, 'a', 'split');
    assert.equal(d.phase, 'done');
    assert.deepEqual(d.players.a.hands.map(h => h.cards.length), [2, 2]);
    assert.equal(d.players.a.hands[0].res, 'Gagné');
    assert.equal(d.players.a.chips, 1040);
});

test('invalid actions and over-budget bets do not change game state', () => {
    const d = roomWithPlayers('a', 'b');
    assert.equal(B.bet(d, 'a', 1001), false);
    assert.equal(B.bet(d, 'a', 9), false);
    assert.equal(B.bet(d, 'a', 10.5), false);
    setDraws(d, card(3), card(4), card(9), card(4), card(5), card(7));
    B.bet(d, 'a', 20);
    B.bet(d, 'b', 20);
    const before = structuredClone(d);
    assert.equal(B.action(d, 'b', 'hit'), false);
    assert.equal(B.action(d, 'a', 'split'), false);
    assert.deepEqual(d, before);
});

test('split limit, double after split, and turn order are enforced', () => {
    const d = roomWithPlayers('a', 'b');
    setDraws(d, card(7), card(4), card(9), card(7, 1), card(5), card(7),
        card(7, 2), card(7, 3), card(7), card(7, 1), card(7, 2), card(7, 3), card(1));
    B.bet(d, 'a', 20);
    B.bet(d, 'b', 20);
    B.action(d, 'a', 'split');
    B.action(d, 'a', 'split');
    B.action(d, 'a', 'split');
    assert.equal(d.players.a.hands.length, 4);
    assert.equal(B.action(d, 'a', 'split'), false);
    B.action(d, 'a', 'double');
    assert.equal(d.players.a.hands[0].cards.length, 3);
    assert.equal(d.players.a.activeHand, 1);
    assert.equal(d.turn, 'a');
});

test('skipping, leaving and explicit rebuy keep multiplayer rounds moving', () => {
    const d = roomWithPlayers('a', 'b');
    setDraws(d, card(7), card(9), card(8), card(7));
    B.bet(d, 'a', 20);
    B.skip(d, 'b');
    assert.equal(d.phase, 'play');
    B.leave(d, 'a');
    assert.equal(d.phase, 'done');
    d.players.b.chips = 0;
    B.again(d);
    assert.equal(d.players.b.st, 'broke');
    assert.equal(d.players.b.chips, 0);
    B.rebuy(d, 'b');
    assert.equal(d.players.b.chips, 1000);
    assert.equal(d.players.b.st, 'bet');
    B.skip(d, 'b');
    B.joinBet(d, 'b');
    assert.equal(d.players.b.st, 'bet');
});
