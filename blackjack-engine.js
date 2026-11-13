(function (root) {
    'use strict';

    const MIN_BET = 10;
    const MAX_HANDS = 4;
    const VERSION = 2;
    const rank = card => card % 13;

    function value(cards) {
        let total = 0, aces = 0;
        for (const card of cards) {
            const r = rank(card);
            if (r === 0) {
                total += 11;
                aces++;
            } else {
                total += Math.min(r + 1, 10);
            }
        }
        while (total > 21 && aces) {
            total -= 10;
            aces--;
        }
        return total;
    }

    function newShoe() {
        const cards = Array.from({length: 312}, (_, i) => i % 52);
        for (let i = cards.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
        return cards;
    }

    function draw(d) {
        if (!d.deck.length) throw Error('Le sabot est vide. Impossible de poursuivre cette manche.');
        return d.deck.pop();
    }

    function makeRoom() {
        return {version: VERSION, phase: 'bet', order: [], players: {}, dealer: [], deck: newShoe(),
            turn: null, turnAt: 0, round: 0, msg: ''};
    }

    function makePlayer(name, phase) {
        return {name, chips: 1000, st: phase === 'bet' ? 'bet' : 'wait', hands: [],
            activeHand: 0, insurance: 0, insuranceDecided: true};
    }

    function finish(d) {
        const dealerBlackjack = d.dealer.length === 2 && value(d.dealer) === 21;
        const contested = d.order.some(u => d.players[u].hands.some(h => h.st === 'stand'));
        if (!dealerBlackjack && contested) {
            while (value(d.dealer) < 17) d.dealer.push(draw(d));
        }
        const dealerValue = value(d.dealer);
        for (const u of d.order) {
            const p = d.players[u];
            if (dealerBlackjack && p.insurance) p.chips += p.insurance * 3;
            for (const h of p.hands) {
                if (h.st === 'surrender') {
                    h.res = 'Abandon';
                } else if (h.st === 'bust') {
                    h.res = 'Perdu';
                } else if (h.st === 'bj' && !dealerBlackjack) {
                    p.chips += h.bet * 2.5;
                    h.res = 'Blackjack !';
                } else if (dealerBlackjack) {
                    if (h.st === 'bj') {
                        p.chips += h.bet;
                        h.res = 'Égalité';
                    } else h.res = 'Perdu';
                } else if (dealerValue > 21 || value(h.cards) > dealerValue) {
                    p.chips += h.bet * 2;
                    h.res = 'Gagné';
                } else if (value(h.cards) === dealerValue) {
                    p.chips += h.bet;
                    h.res = 'Égalité';
                } else h.res = 'Perdu';
            }
        }
        d.phase = 'done';
        d.turn = null;
        d.msg = dealerBlackjack ? 'Blackjack du croupier' : dealerValue > 21
            ? 'Le croupier dépasse 21 !' : 'Le croupier a ' + dealerValue;
    }

    function nextTurn(d) {
        for (const u of d.order) {
            const p = d.players[u];
            const index = p.hands.findIndex(h => h.st === 'play');
            if (index !== -1) {
                p.activeHand = index;
                d.phase = 'play';
                d.turn = u;
                d.turnAt = Date.now();
                return;
            }
        }
        finish(d);
    }

    function peek(d) {
        if (value(d.dealer) === 21) finish(d);
        else nextTurn(d);
    }

    function deal(d) {
        if (d.deck.length < 156) d.deck = newShoe();
        d.dealer = [];
        d.msg = '';
        for (const u of d.order) {
            const p = d.players[u];
            p.insurance = 0;
            p.insuranceDecided = true;
            if (p.st !== 'ready') p.hands = [];
        }
        for (let i = 0; i < 2; i++) {
            for (const u of d.order) {
                const p = d.players[u];
                if (p.st === 'ready') p.hands[0].cards.push(draw(d));
            }
            d.dealer.push(draw(d));
        }
        for (const u of d.order) {
            const p = d.players[u];
            if (p.st === 'ready') {
                p.hands[0].st = value(p.hands[0].cards) === 21 ? 'bj' : 'play';
            }
        }
        if (rank(d.dealer[0]) === 0) {
            d.phase = 'insurance';
            d.turn = null;
            d.turnAt = Date.now();
            for (const u of d.order) {
                const p = d.players[u];
                if (p.hands.length) p.insuranceDecided = false;
            }
        } else {
            peek(d);
        }
    }

    function checkDeal(d) {
        const players = d.order.map(u => d.players[u]);
        if (players.some(p => p.st === 'ready') && players.every(p => p.st !== 'bet')) deal(d);
    }

    function bet(d, uid, amount) {
        const p = d.players[uid];
        if (!p || d.phase !== 'bet' || p.st !== 'bet' || !Number.isInteger(amount) ||
            amount < MIN_BET || amount > p.chips) return false;
        p.chips -= amount;
        p.hands = [{cards: [], bet: amount, st: 'ready', split: false, res: ''}];
        p.st = 'ready';
        checkDeal(d);
    }

    function skip(d, uid) {
        const p = d.players[uid];
        if (!p || d.phase !== 'bet' || p.st !== 'bet') return false;
        p.st = 'wait';
        checkDeal(d);
    }

    function joinBet(d, uid) {
        const p = d.players[uid];
        if (!p || d.phase !== 'bet' || p.st !== 'wait' || p.chips < MIN_BET) return false;
        p.st = 'bet';
    }

    function rebuy(d, uid) {
        const p = d.players[uid];
        if (!p || d.phase !== 'bet' || p.st !== 'broke') return false;
        p.chips += 1000;
        p.st = 'bet';
    }

    function insurance(d, uid, accept) {
        const p = d.players[uid];
        if (!p || d.phase !== 'insurance' || p.insuranceDecided || !p.hands.length) return false;
        const amount = p.hands[0].bet / 2;
        if (accept && p.chips < amount) return false;
        if (accept) {
            p.chips -= amount;
            p.insurance = amount;
        }
        p.insuranceDecided = true;
        if (d.order.every(u => d.players[u].insuranceDecided)) peek(d);
    }

    function current(d, uid) {
        const p = d.players[uid];
        if (!p || d.phase !== 'play' || d.turn !== uid) return null;
        const h = p.hands[p.activeHand];
        return h && h.st === 'play' ? h : null;
    }

    function canSplit(p, h) {
        return h && h.cards.length === 2 && rank(h.cards[0]) === rank(h.cards[1]) &&
            p.hands.length < MAX_HANDS && p.chips >= h.bet && !h.splitAces;
    }

    function action(d, uid, move) {
        const h = current(d, uid);
        if (!h) return false;
        const p = d.players[uid];
        if (move === 'hit') {
            h.cards.push(draw(d));
            if (value(h.cards) >= 21) h.st = value(h.cards) > 21 ? 'bust' : 'stand';
        } else if (move === 'stand') {
            h.st = 'stand';
        } else if (move === 'double') {
            if (h.cards.length !== 2 || p.chips < h.bet) return false;
            p.chips -= h.bet;
            h.bet *= 2;
            h.cards.push(draw(d));
            h.st = value(h.cards) > 21 ? 'bust' : 'stand';
        } else if (move === 'surrender') {
            if (h.cards.length !== 2 || h.split) return false;
            h.st = 'surrender';
            p.chips += h.bet / 2;
        } else if (move === 'split') {
            if (!canSplit(p, h)) return false;
            p.chips -= h.bet;
            const aces = rank(h.cards[0]) === 0;
            const other = {cards: [h.cards.pop()], bet: h.bet, st: 'play', split: true, splitAces: aces, res: ''};
            h.split = true;
            h.splitAces = aces;
            h.cards.push(draw(d));
            other.cards.push(draw(d));
            if (aces || value(h.cards) === 21) h.st = 'stand';
            if (aces || value(other.cards) === 21) other.st = 'stand';
            p.hands.splice(p.activeHand + 1, 0, other);
        } else return false;
        if (h.st === 'play') d.turnAt = Date.now();
        else nextTurn(d);
    }

    function force(d) {
        if (Date.now() - d.turnAt < 20000) return false;
        if (d.phase === 'play' && d.turn) return action(d, d.turn, 'stand');
        if (d.phase === 'insurance') {
            for (const u of d.order) d.players[u].insuranceDecided = true;
            peek(d);
        } else return false;
    }

    function again(d) {
        if (d.phase !== 'done') return false;
        d.round++;
        d.dealer = [];
        d.msg = '';
        for (const u of d.order) {
            const p = d.players[u];
            p.hands = [];
            p.insurance = 0;
            p.insuranceDecided = true;
            p.st = p.chips >= MIN_BET ? 'bet' : 'broke';
        }
        d.phase = 'bet';
        d.turn = null;
    }

    function leave(d, uid) {
        if (!d.players[uid]) return false;
        const wasTurn = d.turn === uid;
        delete d.players[uid];
        d.order = d.order.filter(u => u !== uid);
        if (!d.order.length) {
            d.phase = 'bet';
            d.turn = null;
            d.dealer = [];
        } else if (d.phase === 'play' && wasTurn) nextTurn(d);
        else if (d.phase === 'bet') checkDeal(d);
        else if (d.phase === 'insurance' && d.order.every(u => d.players[u].insuranceDecided)) peek(d);
    }

    root.Blackjack = {VERSION, MIN_BET, MAX_HANDS, value, newShoe, makeRoom, makePlayer,
        bet, skip, joinBet, rebuy, insurance, current, canSplit, action, force, again, leave};
})(globalThis);
