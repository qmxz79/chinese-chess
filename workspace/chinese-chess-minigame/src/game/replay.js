import { advanceGame } from './rules.js';

export function replayMoves(initialBoard, moves) {
  return moves.reduce((board, move) => advanceGame(board, move), initialBoard);
}

export function replayStep(board, index) {
  return board.moveHistory.slice(0, index + 1);
}
