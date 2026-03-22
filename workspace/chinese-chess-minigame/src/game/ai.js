import { PieceType, Side, oppositeSide } from './board.js';
import { advanceGame, getLegalMoves, isInCheck } from './rules.js';

const PIECE_VALUES = {
  [PieceType.ROOK]: 500,
  [PieceType.HORSE]: 270,
  [PieceType.ELEPHANT]: 120,
  [PieceType.ADVISOR]: 120,
  [PieceType.GENERAL]: 20000,
  [PieceType.CANNON]: 300,
  [PieceType.SOLDIER]: 70,
};

function materialScore(board, side) {
  let score = 0;
  for (const piece of board.pieces) {
    if (!piece.alive) continue;
    const value = PIECE_VALUES[piece.type] || 0;
    score += piece.side === side ? value : -value;
  }
  return score;
}

function mobilityScore(board, side) {
  return getLegalMoves(board, side).length;
}

function evaluate(board, side) {
  if (board.status === 'checkmate') {
    return board.winner === side ? 1000000 : -1000000;
  }
  if (board.status === 'draw') return 0;

  let score = materialScore(board, side) + mobilityScore(board, side);

  if (board.lastMove?.capturedPieceId) {
    score += 200;
  }
  if (isInCheck(board, side)) score -= 80;
  if (isInCheck(board, oppositeSide(side))) score += 120;

  return score;
}

function orderMoves(board, moves) {
  return [...moves].sort((a, b) => (b.capturedPieceId ? 1 : 0) - (a.capturedPieceId ? 1 : 0));
}

export function searchBestMove(board, {
  side = board.currentSide,
  depth = 2,
  timeLimitMs = 40,
} = {}) {
  const deadline = Date.now() + timeLimitMs;

  function negamax(position, d, alpha, beta, perspective) {
    if (Date.now() > deadline) throw new Error('AI_TIMEOUT');
    const legal = getLegalMoves(position, position.currentSide);
    if (d === 0 || legal.length === 0 || position.status === 'checkmate' || position.status === 'draw') {
      if (legal.length === 0) {
        if (isInCheck(position, position.currentSide)) {
          return position.currentSide === perspective ? -1000000 : 1000000;
        }
        return 0;
      }
      return evaluate(position, perspective);
    }

    let best = -Infinity;
    const moves = orderMoves(position, legal);
    for (const move of moves) {
      const next = advanceGame(position, move);
      const score = -negamax(next, d - 1, -beta, -alpha, perspective);
      if (score > best) best = score;
      if (score > alpha) alpha = score;
      if (alpha >= beta) break;
    }
    return best;
  }

  const legal = getLegalMoves(board, side);
  if (legal.length === 0) return null;

  let bestMove = legal[0];
  let bestScore = -Infinity;
  for (const move of orderMoves(board, legal)) {
    if (Date.now() > deadline) break;
    const next = advanceGame(board, move);
    try {
      const score = -negamax(next, depth - 1, -Infinity, Infinity, side);
      if (score > bestScore) {
        bestScore = score;
        bestMove = move;
      }
    } catch (err) {
      if (err.message !== 'AI_TIMEOUT') throw err;
      break;
    }
  }

  return bestMove;
}

export { evaluate };
