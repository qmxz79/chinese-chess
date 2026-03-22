const { createInitialBoard, replayMoves, pieceLabel, getPieceAt } = require('../../utils/chess-engine');
const { loadLastMatch, clearLastMatch } = require('../../utils/match-store');

function formatWinnerText(match) {
  if (!match) return '暂无对局结果';
  if (match.status === 'draw') return '本局平局';
  return `${match.winnerText || '对局结束'}，恭喜 ${match.winner === 'red' ? '红方' : '黑方'}`;
}

function buildReplayRows(board) {
  const rows = [];
  for (let y = 0; y < 10; y += 1) {
    const cells = [];
    for (let x = 0; x < 9; x += 1) {
      const piece = getPieceAt(board, x, y);
      cells.push({
        x,
        y,
        key: `${x}:${y}`,
        piece,
        text: piece ? pieceLabel(piece) : '',
      });
    }
    rows.push({ y, cells });
  }
  return rows;
}

Page({
  data: {
    winnerText: '结果占位',
    summary: '这里后续展示胜负、用时和复盘入口。',
    match: null,
    replayIndex: -1,
    replayBoardRows: [],
    replayTitle: '复盘尚未加载',
    movePreview: [],
  },

  onLoad(query = {}) {
    this.loadMatch(query);
  },

  onShow() {
    if (!this.data.match) {
      this.loadMatch({});
    }
  },

  loadMatch(query) {
    const match = loadLastMatch();
    if (!match) {
      this.setData({
        match: null,
        winnerText: '暂无结果',
        summary: '还没有可展示的对局。先回到首页开始一局吧。',
        replayIndex: -1,
        replayBoardRows: buildReplayRows(createInitialBoard()),
        replayTitle: '空白棋盘',
        movePreview: [],
      });
      return;
    }

    const targetStatus = query.status || match.status;
    const winnerText = formatWinnerText({ ...match, status: targetStatus });
    const movePreview = match.moves.map((move, index) => ({
      index,
      label: `${index + 1}. ${move.pieceId} → (${move.to.x},${move.to.y})${move.capturedPieceId ? ` 吃 ${move.capturedPieceId}` : ''}`,
    }));

    this.setData({
      match,
      winnerText,
      summary: `共 ${match.moveCount} 步 · ${match.summary || ''}`,
      replayIndex: match.moves.length - 1,
      movePreview,
    });
    this.renderReplay(match.moves.length - 1);
  },

  renderReplay(index) {
    const match = this.data.match;
    if (!match) return;
    const safeIndex = Math.max(-1, Math.min(index, match.moves.length - 1));
    const board = safeIndex >= 0 ? replayMoves(createInitialBoard(), match.moves.slice(0, safeIndex + 1)) : createInitialBoard();
    this.setData({
      replayIndex: safeIndex,
      replayBoardRows: buildReplayRows(board),
      replayTitle: safeIndex < 0 ? '开局局面' : `第 ${safeIndex + 1} 步后局面`,
    });
  },

  prevStep() {
    if (!this.data.match || this.data.replayIndex < 0) return;
    this.renderReplay(this.data.replayIndex - 1);
  },

  nextStep() {
    if (!this.data.match) return;
    this.renderReplay(this.data.replayIndex + 1);
  },

  jumpToStart() {
    this.renderReplay(-1);
  },

  jumpToEnd() {
    if (!this.data.match) return;
    this.renderReplay(this.data.match.moves.length - 1);
  },

  playAgain() {
    clearLastMatch();
    wx.reLaunch({ url: '/pages/game/game' });
  },

  goHome() {
    wx.reLaunch({ url: '/pages/index/index' });
  },
});
