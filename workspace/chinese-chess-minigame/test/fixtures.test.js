import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createInitialBoard, Side } from '../src/game/board.js';
import { getLegalMoves, isInCheck } from '../src/game/rules.js';
import { searchBestMove } from '../src/game/ai.js';

const rulesCases = JSON.parse(readFileSync(new URL('./fixtures/rule-cases.json', import.meta.url), 'utf8'));
const aiCases = JSON.parse(readFileSync(new URL('./fixtures/ai-cases.json', import.meta.url), 'utf8'));

function toBoard(spec) {
  return {
    pieces: spec.pieces.map((piece) => ({
      id: piece.id,
      type: piece.type,
      side: piece.side,
      pos: { x: piece.x, y: piece.y },
      alive: true,
    })),
    currentSide: spec.currentSide,
    selectedPieceId: null,
    lastMove: null,
    moveHistory: [],
    status: 'playing',
    winner: null,
  };
}

for (const testCase of rulesCases) {
  test(`fixture: ${testCase.name}`, () => {
    const board = toBoard(testCase.board);
    const expect = testCase.board.expect;

    if (expect.pieceCount) {
      assert.equal(board.pieces.length, expect.pieceCount);
    }
    if (expect.currentSide) {
      assert.equal(board.currentSide, expect.currentSide);
    }

    if (expect.rookMoves) {
      const rookMoves = getLegalMoves(board, Side.RED).filter((move) => move.pieceId === 'r-r');
      for (const expectedMove of expect.rookMoves) {
        assert.ok(rookMoves.some((move) => move.to.x === expectedMove.x && move.to.y === expectedMove.y));
      }
    }

    if (expect.soldierMoves) {
      const soldierMoves = getLegalMoves(board, Side.RED).filter((move) => move.pieceId === 'r-s');
      for (const expectedMove of expect.soldierMoves) {
        assert.ok(soldierMoves.some((move) => move.to.x === expectedMove.x && move.to.y === expectedMove.y));
      }
    }

    if (expect.redInCheck !== undefined) {
      assert.equal(isInCheck(board, Side.RED), expect.redInCheck);
    }
    if (expect.blackInCheck !== undefined) {
      assert.equal(isInCheck(board, Side.BLACK), expect.blackInCheck);
    }

    if (expect.cannonCapture) {
      const cannonMoves = getLegalMoves(board, Side.RED).filter((move) => move.pieceId === 'r-c');
      assert.ok(cannonMoves.some((move) => move.to.x === expect.cannonCapture.x && move.to.y === expect.cannonCapture.y));
    }
  });
}

for (const testCase of aiCases) {
  test(`AI fixture: ${testCase.name}`, () => {
    const board = toBoard(testCase.board);
    const move = searchBestMove(board, { side: testCase.side, depth: testCase.depth, timeLimitMs: 20 });
    assert.ok(move);
    if (testCase.expect.hasLegalMove) {
      const legal = getLegalMoves(board, testCase.side === 'red' ? Side.RED : Side.BLACK);
      assert.ok(legal.some((candidate) =>
        candidate.pieceId === move.pieceId &&
        candidate.to.x === move.to.x &&
        candidate.to.y === move.to.y
      ));
    }
  });
}
