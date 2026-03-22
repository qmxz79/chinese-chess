import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialBoard, Side } from '../src/game/board.js';
import { getLegalMoves, isInCheck } from '../src/game/rules.js';

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

test('initial board has 32 pieces and red to move', () => {
  const board = createInitialBoard();
  assert.equal(board.pieces.length, 32);
  assert.equal(board.currentSide, Side.RED);
});

test('rook can move along a clear file but not through blocking piece', () => {
  const board = createInitialBoard();
  const moves = getLegalMoves(board, Side.RED);
  const rookMoves = moves.filter((m) => m.pieceId === 'r-r1');
  assert.ok(rookMoves.some((m) => m.to.x === 0 && m.to.y === 8));
  assert.ok(!rookMoves.some((m) => m.to.x === 0 && m.to.y === 5));
});

test('flying general counts as check', () => {
  const board = boardWithPieces([
    { id: 'r-g', type: 'general', side: Side.RED, pos: { x: 4, y: 9 }, alive: true },
    { id: 'b-g', type: 'general', side: Side.BLACK, pos: { x: 4, y: 0 }, alive: true },
  ]);
  assert.equal(isInCheck(board, Side.RED), true);
  assert.equal(isInCheck(board, Side.BLACK), true);
});

test('soldier after crossing river can move sideways', () => {
  const board = boardWithPieces([
    { id: 'r-g', type: 'general', side: Side.RED, pos: { x: 3, y: 9 }, alive: true },
    { id: 'b-g', type: 'general', side: Side.BLACK, pos: { x: 5, y: 0 }, alive: true },
    { id: 'r-s', type: 'soldier', side: Side.RED, pos: { x: 4, y: 4 }, alive: true },
  ]);
  const moves = getLegalMoves(board, Side.RED).filter((m) => m.pieceId === 'r-s');
  assert.ok(moves.some((m) => m.to.x === 3 && m.to.y === 4));
  assert.ok(moves.some((m) => m.to.x === 5 && m.to.y === 4));
});
