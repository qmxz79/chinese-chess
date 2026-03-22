const BOARD_WIDTH = 9;
const BOARD_HEIGHT = 10;

const Side = Object.freeze({ RED: 'red', BLACK: 'black' });
const PieceType = Object.freeze({
  ROOK: 'rook',
  HORSE: 'horse',
  ELEPHANT: 'elephant',
  ADVISOR: 'advisor',
  GENERAL: 'general',
  CANNON: 'cannon',
  SOLDIER: 'soldier',
});

function oppositeSide(side) {
  return side === Side.RED ? Side.BLACK : Side.RED;
}

function isInsideBoard(x, y) {
  return x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT;
}

function createPiece(id, type, side, x, y) {
  return { id, type, side, pos: { x, y }, alive: true };
}

function createInitialBoard() {
  return {
    pieces: [
      createPiece('b-r1', PieceType.ROOK, Side.BLACK, 0, 0),
      createPiece('b-h1', PieceType.HORSE, Side.BLACK, 1, 0),
      createPiece('b-e1', PieceType.ELEPHANT, Side.BLACK, 2, 0),
      createPiece('b-a1', PieceType.ADVISOR, Side.BLACK, 3, 0),
      createPiece('b-g', PieceType.GENERAL, Side.BLACK, 4, 0),
      createPiece('b-a2', PieceType.ADVISOR, Side.BLACK, 5, 0),
      createPiece('b-e2', PieceType.ELEPHANT, Side.BLACK, 6, 0),
      createPiece('b-h2', PieceType.HORSE, Side.BLACK, 7, 0),
      createPiece('b-r2', PieceType.ROOK, Side.BLACK, 8, 0),
      createPiece('b-c1', PieceType.CANNON, Side.BLACK, 1, 2),
      createPiece('b-c2', PieceType.CANNON, Side.BLACK, 7, 2),
      createPiece('b-s1', PieceType.SOLDIER, Side.BLACK, 0, 3),
      createPiece('b-s2', PieceType.SOLDIER, Side.BLACK, 2, 3),
      createPiece('b-s3', PieceType.SOLDIER, Side.BLACK, 4, 3),
      createPiece('b-s4', PieceType.SOLDIER, Side.BLACK, 6, 3),
      createPiece('b-s5', PieceType.SOLDIER, Side.BLACK, 8, 3),
      createPiece('r-r1', PieceType.ROOK, Side.RED, 0, 9),
      createPiece('r-h1', PieceType.HORSE, Side.RED, 1, 9),
      createPiece('r-e1', PieceType.ELEPHANT, Side.RED, 2, 9),
      createPiece('r-a1', PieceType.ADVISOR, Side.RED, 3, 9),
      createPiece('r-g', PieceType.GENERAL, Side.RED, 4, 9),
      createPiece('r-a2', PieceType.ADVISOR, Side.RED, 5, 9),
      createPiece('r-e2', PieceType.ELEPHANT, Side.RED, 6, 9),
      createPiece('r-h2', PieceType.HORSE, Side.RED, 7, 9),
      createPiece('r-r2', PieceType.ROOK, Side.RED, 8, 9),
      createPiece('r-c1', PieceType.CANNON, Side.RED, 1, 7),
      createPiece('r-c2', PieceType.CANNON, Side.RED, 7, 7),
      createPiece('r-s1', PieceType.SOLDIER, Side.RED, 0, 6),
      createPiece('r-s2', PieceType.SOLDIER, Side.RED, 2, 6),
      createPiece('r-s3', PieceType.SOLDIER, Side.RED, 4, 6),
      createPiece('r-s4', PieceType.SOLDIER, Side.RED, 6, 6),
      createPiece('r-s5', PieceType.SOLDIER, Side.RED, 8, 6),
    ],
    currentSide: Side.RED,
    selectedPieceId: null,
    lastMove: null,
    moveHistory: [],
    status: 'playing',
    winner: null,
  };
}

function cloneBoard(board) {
  return {
    ...board,
    pieces: board.pieces.map((piece) => ({ ...piece, pos: { ...piece.pos } })),
    lastMove: board.lastMove ? { ...board.lastMove, from: { ...board.lastMove.from }, to: { ...board.lastMove.to } } : null,
    moveHistory: board.moveHistory.map((move) => ({ ...move, from: { ...move.from }, to: { ...move.to } })),
  };
}

function getPieceAt(board, x, y) {
  return board.pieces.find((piece) => piece.alive && piece.pos.x === x && piece.pos.y === y) || null;
}

function getPiecesBySide(board, side) {
  return board.pieces.filter((piece) => piece.alive && piece.side === side);
}

function getGeneral(board, side) {
  return board.pieces.find((piece) => piece.alive && piece.side === side && piece.type === PieceType.GENERAL) || null;
}

function inPalace(side, x, y) {
  const palace = side === Side.RED ? { xMin: 3, xMax: 5, yMin: 7, yMax: 9 } : { xMin: 3, xMax: 5, yMin: 0, yMax: 2 };
  return x >= palace.xMin && x <= palace.xMax && y >= palace.yMin && y <= palace.yMax;
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
      for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx;
        const ny = y + dy;
        if (isInsideBoard(nx, ny) && inPalace(piece.side, nx, ny)) addMove(board, piece, nx, ny, moves);
      }
      break;
    }
    case PieceType.GENERAL: {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
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
            if (!target) addMove(board, piece, cx, cy, moves);
            else screenSeen = true;
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

function getLegalMoves(board, side = board.currentSide) {
  const moves = [];
  for (const piece of getPiecesBySide(board, side)) {
    for (const move of pseudoMovesForPiece(board, piece)) {
      if (moveLeavesOwnGeneralSafe(board, move, side)) moves.push(move);
    }
  }
  return moves;
}

function isSquareAttacked(board, x, y, bySide) {
  for (const piece of getPiecesBySide(board, bySide)) {
    const { x: px, y: py } = piece.pos;
    switch (piece.type) {
      case PieceType.ROOK:
        if ((px === x || py === y) && clearLine(board, piece.pos, { x, y })) return true;
        break;
      case PieceType.HORSE: {
        const dx = Math.abs(px - x);
        const dy = Math.abs(py - y);
        if ((dx === 1 && dy === 2 && !getPieceAt(board, px, py + (y > py ? 1 : -1))) ||
            (dx === 2 && dy === 1 && !getPieceAt(board, px + (x > px ? 1 : -1), py))) return true;
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
      case PieceType.CANNON:
        if ((px === x || py === y) && countBetween(board, piece.pos, { x, y }) === 1) return true;
        break;
      case PieceType.SOLDIER: {
        const dir = forwardDelta(piece.side);
        if (px === x && py + dir === y) return true;
        if (crossedRiver(piece.side, py) && py === y && (px + 1 === x || px - 1 === x)) return true;
        break;
      }
      default:
        break;
    }
  }
  return false;
}

function isInCheck(board, side) {
  const general = getGeneral(board, side);
  if (!general) return true;
  return isSquareAttacked(board, general.pos.x, general.pos.y, oppositeSide(side));
}

function advanceGame(board, move) {
  const next = cloneBoard(board);
  const piece = next.pieces.find((p) => p.id === move.pieceId && p.alive);
  const target = getPieceAt(next, move.to.x, move.to.y);
  if (target) target.alive = false;
  piece.pos = { x: move.to.x, y: move.to.y };
  next.lastMove = { pieceId: piece.id, from: { ...move.from }, to: { ...move.to }, capturedPieceId: target ? target.id : null };
  next.moveHistory = [...next.moveHistory, next.lastMove];
  next.currentSide = oppositeSide(board.currentSide);
  next.selectedPieceId = null;

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

const PIECE_LABELS = {
  red: {
    rook: '车', horse: '马', elephant: '相', advisor: '仕', general: '帅', cannon: '炮', soldier: '兵',
  },
  black: {
    rook: '车', horse: '马', elephant: '象', advisor: '士', general: '将', cannon: '炮', soldier: '卒',
  },
};

function pieceLabel(piece) {
  return PIECE_LABELS[piece.side][piece.type] || '?';
}

function searchBestMove(board, { side = board.currentSide, depth = 1, timeLimitMs = 60 } = {}) {
  const legal = getLegalMoves(board, side);
  if (!legal.length) return null;

  let bestMove = legal[0];
  let bestScore = -Infinity;
  for (const move of legal) {
    const next = advanceGame(board, move);
    let score = 0;
    if (move.capturedPieceId) score += 1000;
    if (next.status === 'checkmate') score += 99999;
    if (next.status === 'check') score += 30;
    if (move.pieceId.includes('r') && move.to.y < move.from.y) score += 1;
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function replayMoves(initialBoard, moves) {
  return moves.reduce((board, move) => advanceGame(board, move), initialBoard);
}

module.exports = {
  BOARD_WIDTH,
  BOARD_HEIGHT,
  Side,
  PieceType,
  oppositeSide,
  isInsideBoard,
  createInitialBoard,
  cloneBoard,
  getPieceAt,
  getLegalMoves,
  isInCheck,
  advanceGame,
  searchBestMove,
  pieceLabel,
  replayMoves,
};
