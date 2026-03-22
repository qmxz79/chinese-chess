export const BOARD_WIDTH = 9;
export const BOARD_HEIGHT = 10;

export const Side = Object.freeze({ RED: 'red', BLACK: 'black' });
export const PieceType = Object.freeze({
  ROOK: 'rook',
  HORSE: 'horse',
  ELEPHANT: 'elephant',
  ADVISOR: 'advisor',
  GENERAL: 'general',
  CANNON: 'cannon',
  SOLDIER: 'soldier',
});

export function oppositeSide(side) {
  return side === Side.RED ? Side.BLACK : Side.RED;
}

export function isInsideBoard(x, y) {
  return x >= 0 && x < BOARD_WIDTH && y >= 0 && y < BOARD_HEIGHT;
}

function createPiece(id, type, side, x, y) {
  return { id, type, side, pos: { x, y }, alive: true };
}

export function createInitialBoard() {
  const pieces = [
    // black
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

    // red
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
  ];

  return {
    pieces,
    currentSide: Side.RED,
    selectedPieceId: null,
    lastMove: null,
    moveHistory: [],
    status: 'playing',
    winner: null,
  };
}

export function cloneBoard(board) {
  return {
    ...board,
    pieces: board.pieces.map((piece) => ({
      ...piece,
      pos: { ...piece.pos },
    })),
    lastMove: board.lastMove ? {
      ...board.lastMove,
      from: { ...board.lastMove.from },
      to: { ...board.lastMove.to },
    } : null,
    moveHistory: board.moveHistory.map((move) => ({
      ...move,
      from: { ...move.from },
      to: { ...move.to },
    })),
  };
}

export function getPieceAt(board, x, y) {
  return board.pieces.find((piece) => piece.alive && piece.pos.x === x && piece.pos.y === y) || null;
}

export function getPiecesBySide(board, side) {
  return board.pieces.filter((piece) => piece.alive && piece.side === side);
}

export function getGeneral(board, side) {
  return board.pieces.find((piece) => piece.alive && piece.side === side && piece.type === PieceType.GENERAL) || null;
}

export function applyMove(board, move) {
  const next = cloneBoard(board);
  const piece = next.pieces.find((p) => p.id === move.pieceId && p.alive);
  if (!piece) throw new Error(`piece not found: ${move.pieceId}`);

  const target = getPieceAt(next, move.to.x, move.to.y);
  if (target && target.side === piece.side) {
    throw new Error('cannot capture own piece');
  }
  if (target) target.alive = false;

  piece.pos = { x: move.to.x, y: move.to.y };
  next.lastMove = {
    pieceId: piece.id,
    from: { ...move.from },
    to: { ...move.to },
    capturedPieceId: target ? target.id : null,
  };
  next.moveHistory = [...next.moveHistory, next.lastMove];
  next.currentSide = oppositeSide(board.currentSide);
  next.selectedPieceId = null;
  return next;
}
