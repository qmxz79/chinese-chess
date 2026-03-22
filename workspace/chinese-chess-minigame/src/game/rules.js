import {
  BOARD_HEIGHT,
  BOARD_WIDTH,
  PieceType,
  Side,
  applyMove,
  getGeneral,
  getPieceAt,
  getPiecesBySide,
  isInsideBoard,
  oppositeSide,
} from './board.js';

const PALACE = {
  red: { xMin: 3, xMax: 5, yMin: 7, yMax: 9 },
  black: { xMin: 3, xMax: 5, yMin: 0, yMax: 2 },
};

function inPalace(side, x, y) {
  const p = PALACE[side];
  return x >= p.xMin && x <= p.xMax && y >= p.yMin && y <= p.yMax;
}

function crossedRiver(side, y) {
  return side === Side.RED ? y <= 4 : y >= 5;
}

function forwardDelta(side) {
  return side === Side.RED ? -1 : 1;
}

function clearLine(board, from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  while (x !== to.x || y !== to.y) {
    if (getPieceAt(board, x, y)) return false;
    x += dx;
    y += dy;
  }
  return true;
}

function countBetween(board, from, to) {
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  let x = from.x + dx;
  let y = from.y + dy;
  let count = 0;
  while (x !== to.x || y !== to.y) {
    if (getPieceAt(board, x, y)) count += 1;
    x += dx;
    y += dy;
  }
  return count;
}

function addMove(board, piece, x, y, moves) {
  if (!isInsideBoard(x, y)) return;
  const target = getPieceAt(board, x, y);
  if (target && target.side === piece.side) return;
  moves.push({
    pieceId: piece.id,
    from: { x: piece.pos.x, y: piece.pos.y },
    to: { x, y },
    capturedPieceId: target ? target.id : null,
  });
}

function pseudoMovesForPiece(board, piece) {
  const moves = [];
  const { x, y } = piece.pos;

  switch (piece.type) {
    case PieceType.ROOK: {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of dirs) {
        let cx = x + dx;
        let cy = y + dy;
        while (isInsideBoard(cx, cy)) {
          const target = getPieceAt(board, cx, cy);
          if (!target) {
            addMove(board, piece, cx, cy, moves);
          } else {
            if (target.side !== piece.side) addMove(board, piece, cx, cy, moves);
            break;
          }
          cx += dx;
          cy += dy;
        }
      }
      break;
    }
    case PieceType.HORSE: {
      const candidates = [
        { dx: 2, dy: 1, leg: { x: x + 1, y } },
        { dx: 2, dy: -1, leg: { x: x + 1, y } },
        { dx: -2, dy: 1, leg: { x: x - 1, y } },
        { dx: -2, dy: -1, leg: { x: x - 1, y } },
        { dx: 1, dy: 2, leg: { x, y: y + 1 } },
        { dx: -1, dy: 2, leg: { x, y: y + 1 } },
        { dx: 1, dy: -2, leg: { x, y: y - 1 } },
        { dx: -1, dy: -2, leg: { x, y: y - 1 } },
      ];
      for (const c of candidates) {
        if (!getPieceAt(board, c.leg.x, c.leg.y)) addMove(board, piece, x + c.dx, y + c.dy, moves);
      }
      break;
    }
    case PieceType.ELEPHANT: {
      const candidates = [
        { dx: 2, dy: 2, eye: { x: x + 1, y: y + 1 } },
        { dx: 2, dy: -2, eye: { x: x + 1, y: y - 1 } },
        { dx: -2, dy: 2, eye: { x: x - 1, y: y + 1 } },
        { dx: -2, dy: -2, eye: { x: x - 1, y: y - 1 } },
      ];
      for (const c of candidates) {
        const nx = x + c.dx;
        const ny = y + c.dy;
        if (!isInsideBoard(nx, ny)) continue;
        if (piece.side === Side.RED && ny < 5) continue;
        if (piece.side === Side.BLACK && ny > 4) continue;
        if (!getPieceAt(board, c.eye.x, c.eye.y)) addMove(board, piece, nx, ny, moves);
      }
      break;
    }
    case PieceType.ADVISOR: {
      const candidates = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
      for (const [dx, dy] of candidates) {
        const nx = x + dx;
        const ny = y + dy;
        if (isInsideBoard(nx, ny) && inPalace(piece.side, nx, ny)) addMove(board, piece, nx, ny, moves);
      }
      break;
    }
    case PieceType.GENERAL: {
      const candidates = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of candidates) {
        const nx = x + dx;
        const ny = y + dy;
        if (isInsideBoard(nx, ny) && inPalace(piece.side, nx, ny)) addMove(board, piece, nx, ny, moves);
      }
      const enemy = getGeneral(board, oppositeSide(piece.side));
      if (enemy && enemy.pos.x === x && clearLine(board, piece.pos, enemy.pos)) {
        addMove(board, piece, enemy.pos.x, enemy.pos.y, moves);
      }
      break;
    }
    case PieceType.CANNON: {
      const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of dirs) {
        let cx = x + dx;
        let cy = y + dy;
        let screenSeen = false;
        while (isInsideBoard(cx, cy)) {
          const target = getPieceAt(board, cx, cy);
          if (!screenSeen) {
            if (!target) {
              addMove(board, piece, cx, cy, moves);
            } else {
              screenSeen = true;
            }
          } else if (target) {
            if (target.side !== piece.side) addMove(board, piece, cx, cy, moves);
            break;
          }
          cx += dx;
          cy += dy;
        }
      }
      break;
    }
    case PieceType.SOLDIER: {
      addMove(board, piece, x, y + forwardDelta(piece.side), moves);
      if (crossedRiver(piece.side, y)) {
        addMove(board, piece, x + 1, y, moves);
        addMove(board, piece, x - 1, y, moves);
      }
      break;
    }
    default:
      break;
  }

  return moves;
}

function moveLeavesOwnGeneralSafe(board, move, side) {
  const next = applyMove(board, move);
  return !isInCheck(next, side);
}

export function getLegalMoves(board, side = board.currentSide) {
  const pieces = getPiecesBySide(board, side);
  const moves = [];
  for (const piece of pieces) {
    const pseudo = pseudoMovesForPiece(board, piece);
    for (const move of pseudo) {
      if (moveLeavesOwnGeneralSafe(board, move, side)) moves.push(move);
    }
  }
  return moves;
}

export function isSquareAttacked(board, x, y, bySide) {
  const pieces = getPiecesBySide(board, bySide);
  for (const piece of pieces) {
    const { x: px, y: py } = piece.pos;
    switch (piece.type) {
      case PieceType.ROOK:
        if ((px === x || py === y) && clearLine(board, piece.pos, { x, y })) return true;
        break;
      case PieceType.HORSE: {
        const dx = Math.abs(px - x);
        const dy = Math.abs(py - y);
        if ((dx === 1 && dy === 2 && !getPieceAt(board, px, py + (y > py ? 1 : -1))) ||
            (dx === 2 && dy === 1 && !getPieceAt(board, px + (x > px ? 1 : -1), py))) {
          return true;
        }
        break;
      }
      case PieceType.ELEPHANT: {
        const dx = Math.abs(px - x);
        const dy = Math.abs(py - y);
        if (dx === 2 && dy === 2) {
          if (piece.side === Side.RED && y < 5) break;
          if (piece.side === Side.BLACK && y > 4) break;
          const eye = { x: (px + x) / 2, y: (py + y) / 2 };
          if (!getPieceAt(board, eye.x, eye.y)) return true;
        }
        break;
      }
      case PieceType.ADVISOR:
        if (Math.abs(px - x) === 1 && Math.abs(py - y) === 1 && inPalace(piece.side, x, y)) return true;
        break;
      case PieceType.GENERAL:
        if (Math.abs(px - x) + Math.abs(py - y) === 1 && inPalace(piece.side, x, y)) return true;
        if (px === x) {
          const targetGeneral = getGeneral(board, oppositeSide(piece.side));
          if (targetGeneral && targetGeneral.pos.x === x && targetGeneral.pos.y === y && clearLine(board, piece.pos, targetGeneral.pos)) return true;
        }
        break;
      case PieceType.CANNON: {
        if (px === x || py === y) {
          const count = countBetween(board, piece.pos, { x, y });
          if (count === 1) return true;
        }
        break;
      }
      case PieceType.SOLDIER: {
        const dir = forwardDelta(piece.side);
        const forward = { x: px, y: py + dir };
        if (forward.x === x && forward.y === y) return true;
        if (crossedRiver(piece.side, py)) {
          if ((px + 1 === x || px - 1 === x) && py === y) return true;
        }
        break;
      }
      default:
        break;
    }
  }
  return false;
}

export function isInCheck(board, side) {
  const general = getGeneral(board, side);
  if (!general) return true;
  return isSquareAttacked(board, general.pos.x, general.pos.y, oppositeSide(side));
}

export function isCheckmate(board, side = board.currentSide) {
  return isInCheck(board, side) && getLegalMoves(board, side).length === 0;
}

export function isStalemate(board, side = board.currentSide) {
  return !isInCheck(board, side) && getLegalMoves(board, side).length === 0;
}

export function isDraw(board, side = board.currentSide) {
  return isStalemate(board, side);
}

export function advanceGame(board, move) {
  const next = applyMove(board, move);
  const sideToMove = next.currentSide;
  const legalMoves = getLegalMoves(next, sideToMove);
  if (legalMoves.length === 0) {
    if (isInCheck(next, sideToMove)) {
      next.status = 'checkmate';
      next.winner = oppositeSide(sideToMove);
    } else {
      next.status = 'draw';
      next.winner = null;
    }
  } else if (isInCheck(next, sideToMove)) {
    next.status = 'check';
    next.winner = null;
  } else {
    next.status = 'playing';
    next.winner = null;
  }
  return next;
}

export { pseudoMovesForPiece };
