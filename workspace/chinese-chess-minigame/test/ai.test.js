import test from 'node:test';
import assert from 'node:assert/strict';
import { Side } from '../src/game/board.js';
import { searchBestMove, evaluate } from '../src/game/ai.js';
import { getLegalMoves } from '../src/game/rules.js';

function boardWithPieces(pieces, currentSide = Side.RED) {
  return {
    pieces,
    currentSide,
    selectedPieceId: null,
    lastMove: null,
    moveHistory: [],
    status: 'playing',
    winner: null,
  };
}

test('AI returns a legal move in a simple tactical position', () => {
  const board = boardWithPieces([
    { id: 'r-g', type: 'general', side: Side.RED, pos: { x: 4, y: 9 }, alive: true },
    { id: 'b-g', type: 'general', side: Side.BLACK, pos: { x: 4, y: 0 }, alive: true },
    { id: 'r-r', type: 'rook', side: Side.RED, pos: { x: 4, y: 8 }, alive: true },
    { id: 'b-s', type: 'soldier', side: Side.BLACK, pos: { x: 4, y: 5 }, alive: true },
  ]);
  const move = searchBestMove(board, { side: Side.RED, depth: 1, timeLimitMs: 20 });
  assert.ok(move);
  const legal = getLegalMoves(board, Side.RED);
  assert.ok(legal.some((candidate) =>
    candidate.pieceId === move.pieceId &&
    candidate.to.x === move.to.x &&
    candidate.to.y === move.to.y
  ));
});

test('evaluation prefers material advantage', () => {
  const strong = boardWithPieces([
    { id: 'r-g', type: 'general', side: Side.RED, pos: { x: 4, y: 9 }, alive: true },
    { id: 'b-g', type: 'general', side: Side.BLACK, pos: { x: 4, y: 0 }, alive: true },
    { id: 'r-r', type: 'rook', side: Side.RED, pos: { x: 0, y: 9 }, alive: true },
  ]);
  const weak = boardWithPieces([
    { id: 'r-g', type: 'general', side: Side.RED, pos: { x: 4, y: 9 }, alive: true },
    { id: 'b-g', type: 'general', side: Side.BLACK, pos: { x: 4, y: 0 }, alive: true },
  ]);
  assert.ok(evaluate(strong, Side.RED) > evaluate(weak, Side.RED));
});
