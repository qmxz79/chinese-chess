const { createGameState } = require('../../utils/game-state');
const {
  Side,
  oppositeSide,
  createInitialBoard,
  cloneBoard,
  getPieceAt,
  getLegalMoves,
  advanceGame,
  searchBestMove,
  replayMoves,
  pieceLabel,
} = require('../../utils/chess-engine');
const {
  MatchMode,
  MatchState,
  MatchEventType,
  createMatchRoom,
  canSendMove,
  applyMatchEvent,
} = require('../../utils/match-protocol');
const {
  TransportStatus,
  createMatchSignalClient,
} = require('../../utils/match-signal');
const {
  saveLastMatch,
  saveMatchRoom,
  loadMatchRoom,
  saveSignalUrl,
  loadSignalUrl,
} = require('../../utils/match-store');

function generateRoomId() {
  return `R${Date.now().toString(36).slice(-6).toUpperCase()}`;
}

function generatePlayerId() {
  return `P${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();
}

function normalizeRoomId(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, '')
    .slice(0, 24);
}

function buildRoomStatus(room) {
  if (!room || !room.roomId) return '未进入房间';
  const opponent = room.opponentId || '待分配';
  return `房间号：${room.roomId} · 我方：${room.selfSide || '-'} · 对手：${opponent} · 身份：${room.selfId || '-'}`;
}

function createAcceptPayload(localRoom, envelope) {
  const hostPreferredSide = envelope && envelope.payload && isSideValue(envelope.payload.desiredSide)
    ? envelope.payload.desiredSide
    : Side.RED;
  const guestSide = oppositeSide(hostPreferredSide);
  return {
    roomId: (envelope && envelope.roomId) || localRoom.roomId,
    senderId: localRoom.selfId,
    opponentId: (envelope && envelope.senderId) || localRoom.opponentId,
    selfSide: guestSide,
    seed: envelope && envelope.payload ? envelope.payload.seed : localRoom.seed,
  };
}

function coordKey(x, y) {
  return `${x}:${y}`;
}

function formatCoord({ x, y }) {
  return `(${x},${y})`;
}

function buildBoardView(board, selectedPieceId, legalMoves, hintMove, syncMarkers) {
  const legalMap = new Set((legalMoves || []).map((move) => coordKey(move.to.x, move.to.y)));
  const hintMap = hintMove
    ? new Set([coordKey(hintMove.from.x, hintMove.from.y), coordKey(hintMove.to.x, hintMove.to.y)])
    : new Set();
  const syncMap = new Set((syncMarkers || []).map((move) => coordKey(move.x, move.y)));
  const lastMoveMap = board.lastMove
    ? new Set([coordKey(board.lastMove.from.x, board.lastMove.from.y), coordKey(board.lastMove.to.x, board.lastMove.to.y)])
    : new Set();

  const rows = [];
  for (let y = 0; y < 10; y += 1) {
    const cells = [];
    for (let x = 0; x < 9; x += 1) {
      const piece = getPieceAt(board, x, y);
      const selected = piece && piece.id === selectedPieceId;
      const legalTarget = legalMap.has(coordKey(x, y));
      const hintTarget = hintMap.has(coordKey(x, y));
      const syncTarget = syncMap.has(coordKey(x, y));
      const lastMove = lastMoveMap.has(coordKey(x, y));
      cells.push({
        x,
        y,
        key: coordKey(x, y),
        piece,
        text: piece ? pieceLabel(piece) : '',
        selected,
        legalTarget,
        hintTarget,
        syncTarget,
        lastMove,
      });
    }
    rows.push({ y, cells });
  }
  return rows;
}

function describeRoom(room, transportStatus) {
  const statusText = {
    [TransportStatus.IDLE]: '未连接',
    [TransportStatus.CONNECTING]: '连接中',
    [TransportStatus.OPEN]: '已连接',
    [TransportStatus.CLOSING]: '断开中',
    [TransportStatus.CLOSED]: '已断开',
    [TransportStatus.ERROR]: '连接异常',
  }[transportStatus] || '未知';

  const roomText = room
    ? `协议状态：${room.state} · 回合：${room.turn} · 序号：${room.sequence}`
    : '协议状态：未知';

  return `${statusText} · ${roomText}`;
}

function cloneMove(move) {
  return move
    ? {
        ...move,
        from: { ...move.from },
        to: { ...move.to },
      }
    : null;
}

function isSideValue(side) {
  return side === Side.RED || side === Side.BLACK;
}

function getMoveSequence(board) {
  return board && Array.isArray(board.moveHistory) ? board.moveHistory.length : 0;
}

function sameMove(a, b) {
  if (!a || !b || !a.from || !a.to || !b.from || !b.to) return false;
  return a.pieceId === b.pieceId
    && a.from.x === b.from.x
    && a.from.y === b.from.y
    && a.to.x === b.to.x
    && a.to.y === b.to.y;
}

function normalizeTurn(side, fallback = Side.RED) {
  return isSideValue(side) ? side : fallback;
}

function legalMoveExists(board, side, move) {
  if (!board || !move || !isSideValue(side)) return false;
  return getLegalMoves(board, side).some((candidate) => sameMove(candidate, move));
}

function safeReplayBoard(boardSnapshot, moveLog) {
  const history = Array.isArray(moveLog) ? moveLog.filter(Boolean).map(cloneMove) : [];
  if (!history.length) {
    return {
      board: boardSnapshot && boardSnapshot.pieces ? cloneBoard(boardSnapshot) : createInitialBoard(),
      history: [],
      usedReplay: false,
    };
  }

  try {
    return {
      board: replayMoves(createInitialBoard(), history),
      history,
      usedReplay: true,
    };
  } catch (error) {
    return {
      board: boardSnapshot && boardSnapshot.pieces ? cloneBoard(boardSnapshot) : createInitialBoard(),
      history: [],
      usedReplay: false,
      error,
    };
  }
}

Page({
  data: {
    state: createGameState(),
    board: createInitialBoard(),
    boardRows: [],
    selectedPieceId: null,
    legalMoves: [],
    hintMove: null,
    hintText: '点击“提示”获取推荐走法',
    matchRoom: createMatchRoom(),
    roomStatusText: '未进入房间',
    roomInputValue: '',
    connectionStatus: '未连接在线房间',
    transportStatus: TransportStatus.IDLE,
    signalUrl: loadSignalUrl(),
    syncMarkers: [],
    logLines: [],
    tips: [
      '点棋子选中，再点可落位置',
      '红方先手，默认是人机对战',
      '在线模式下会自动同步信令事件',
      '提示只建议当前回合可走的一步',
    ],
  },

  onLoad() {
    this.boardHistory = [];
    this.aiTimer = null;
    this.localMatchId = `local-${Date.now()}`;
    const storedRoom = loadMatchRoom();
    this.matchRoom = storedRoom || createMatchRoom({ mode: MatchMode.ONLINE, state: MatchState.IDLE });
    if (!this.matchRoom.selfId) {
      this.matchRoom = {
        ...this.matchRoom,
        selfId: generatePlayerId(),
      };
    }
    const initialSignalUrl = this.data.signalUrl;

    this.signalClient = createMatchSignalClient({
      room: this.matchRoom,
      url: initialSignalUrl,
      onRoomChange: (room, envelope) => this.onRoomChange(room, envelope),
      onTransportChange: (transport) => this.onTransportChange(transport),
      onEnvelope: (envelope) => this.handleSignalEnvelope(envelope),
      onError: (error) => this.appendLog(`错误：${error.code || 'UNKNOWN'} ${error.message || ''}`.trim()),
    });

    this.setData({
      matchRoom: this.matchRoom,
      roomStatusText: buildRoomStatus(this.matchRoom),
      roomInputValue: this.matchRoom.roomId || '',
      transportStatus: this.signalClient.getTransportState().status,
      connectionStatus: this.describeConnection(this.matchRoom, this.signalClient.getTransportState().status),
    });

    if (this.matchRoom && this.matchRoom.snapshot) {
      this.syncBoardFromRoom(this.matchRoom.snapshot, this.matchRoom.turn, this.matchRoom.sequence, this.matchRoom.moveLog, {
        reason: 'restore',
        allowOlder: true,
      });
    }

    this.refreshBoard('游戏页已就绪');
  },

  onUnload() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    if (this.signalClient) this.signalClient.dispose();
  },

  appendLog(line) {
    const stamp = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const logLines = [...(this.data.logLines || []), `[${stamp}] ${line}`].slice(-24);
    this.setData({ logLines });
  },

  describeConnection(room, transportStatus) {
    return describeRoom(room, transportStatus);
  },

  persistMatchRoom(room) {
    this.matchRoom = room;
    saveMatchRoom(room);
    this.setData({
      matchRoom: room,
      roomStatusText: buildRoomStatus(room),
      roomInputValue: room && room.roomId ? room.roomId : this.data.roomInputValue,
      connectionStatus: this.describeConnection(room, this.data.transportStatus),
    });
  },

  onTransportChange(transport) {
    this.setData({
      transportStatus: transport.status,
      connectionStatus: this.describeConnection(this.matchRoom, transport.status),
    });
    if (transport.lastError) {
      this.appendLog(`信令状态：${transport.lastError.code || 'ERROR'}`);
    }
    if (
      transport.status === TransportStatus.OPEN
      && this.isOnlineMode()
      && this.matchRoom
      && this.matchRoom.snapshot
      && this.matchRoom.roomId
      && this.matchRoom.state !== MatchState.IDLE
      && this.matchRoom.state !== MatchState.MATCHING
    ) {
      this.signalClient.sendSync(cloneBoard(this.data.board), this.data.board.currentSide, getMoveSequence(this.data.board));
      this.appendLog('连接恢复后已主动同步本地局面');
    }
  },

  onRoomChange(room, envelope) {
    if (envelope && envelope.type === MatchEventType.MOVE) {
      return;
    }

    let nextRoom = room;
    if (
      envelope
      && this.matchRoom
      && [
        MatchEventType.ACK,
        MatchEventType.HEARTBEAT,
        MatchEventType.DRAW_OFFER,
        MatchEventType.DRAW_RESPONSE,
        MatchEventType.RESIGN,
        MatchEventType.ERROR,
      ].includes(envelope.type)
    ) {
      nextRoom = {
        ...room,
        turn: this.matchRoom.turn,
        sequence: this.matchRoom.sequence,
        snapshot: room.snapshot || this.matchRoom.snapshot,
        moveLog: Array.isArray(this.matchRoom.moveLog) ? [...this.matchRoom.moveLog] : [],
      };
    }

    this.persistMatchRoom(nextRoom);
    if (envelope) {
      this.appendLog(`房间更新：${envelope.type}`);
    }
    if (nextRoom.snapshot && nextRoom.state === MatchState.SYNCHRONIZING) {
      const incomingMoveLog = envelope && envelope.payload && Array.isArray(envelope.payload.moveLog)
        ? envelope.payload.moveLog
        : null;
      this.syncBoardFromRoom(nextRoom.snapshot, nextRoom.turn, nextRoom.sequence, incomingMoveLog);
    }
  },

  refreshBoard(message = null, overrideLegalMoves = null, overrideHintMove = null, overrideSyncMarkers = null) {
    const legalMoves = overrideLegalMoves || this.data.legalMoves;
    const hintMove = typeof overrideHintMove === 'undefined' ? this.data.hintMove : overrideHintMove;
    const syncMarkers = typeof overrideSyncMarkers === 'undefined' ? this.data.syncMarkers : overrideSyncMarkers;
    const boardRows = buildBoardView(this.data.board, this.data.selectedPieceId, legalMoves, hintMove, syncMarkers);
    const nextState = {
      ...this.data.state,
      mode: this.matchRoom.mode || this.data.state.mode,
      side: this.data.board.currentSide,
      status: this.data.board.status,
      winner: this.data.board.winner,
      moveCount: this.data.board.moveHistory.length,
      message: message || this.data.state.message,
    };

    this.setData({
      boardRows,
      state: nextState,
      hintText: message || this.data.hintText,
    });
  },

  saveMatchResult(board) {
    const match = {
      status: board.status,
      winner: board.winner,
      winnerText: board.winner === Side.RED ? '红方获胜' : board.winner === Side.BLACK ? '黑方获胜' : '平局',
      moveCount: board.moveHistory.length,
      summary: board.status === 'draw'
        ? '双方都没有可走棋步'
        : board.status === 'checkmate'
          ? '一方被将死'
          : '对局结束',
      moves: board.moveHistory.map(cloneMove),
      board: cloneBoard(board),
      finishedAt: Date.now(),
    };
    saveLastMatch(match);
  },

  finishIfNeeded(nextBoard) {
    if (nextBoard.status === 'playing' || nextBoard.status === 'check') return false;
    this.saveMatchResult(nextBoard);
    if (this.matchRoom) {
      this.persistMatchRoom({
        ...this.matchRoom,
        state: MatchState.FINISHED,
        turn: nextBoard.currentSide,
        result: { winner: nextBoard.winner, reason: nextBoard.status },
        snapshot: cloneBoard(nextBoard),
      });
    }
    const resultUrl = `/pages/result/result?status=${nextBoard.status}&winner=${nextBoard.winner || ''}`;
    wx.reLaunch({ url: resultUrl });
    return true;
  },

  canActOnBoard() {
    return this.data.board.status === 'playing' || this.data.board.status === 'check';
  },

  getLocalTurnBlockReason() {
    if (!this.isOnlineMode()) return '';
    if (!this.matchRoom || !isSideValue(this.matchRoom.selfSide)) return '当前在线房间缺少本方身份';
    if (this.matchRoom.state !== MatchState.PLAYING) return '当前房间还没有进入对局';
    if (this.matchRoom.turn !== this.matchRoom.selfSide) return '还没轮到你';
    if (this.data.board.currentSide !== this.matchRoom.selfSide) {
      return '当前棋盘回合与房间状态不一致，等待同步';
    }
    return '';
  },

  isOnlineMode() {
    return this.matchRoom && this.matchRoom.mode === MatchMode.ONLINE;
  },

  isMyTurn() {
    return !this.getLocalTurnBlockReason();
  },

  getExpectedOpponentSide() {
    if (!this.matchRoom || !isSideValue(this.matchRoom.selfSide)) return null;
    return isSideValue(this.matchRoom.opponentSide)
      ? this.matchRoom.opponentSide
      : oppositeSide(this.matchRoom.selfSide);
  },

  isKnownOpponentEnvelope(envelope) {
    if (!this.matchRoom || !envelope) return false;
    if (envelope.senderId && this.matchRoom.selfId && envelope.senderId === this.matchRoom.selfId) return false;
    if (this.matchRoom.opponentId && envelope.senderId && envelope.senderId !== this.matchRoom.opponentId) return false;
    return true;
  },

  shouldAcceptEnvelope(envelope) {
    if (!this.matchRoom || !envelope) return false;
    if (envelope.roomId && this.matchRoom.roomId && envelope.roomId !== this.matchRoom.roomId) {
      this.appendLog(`忽略其他房间消息：${envelope.type}`);
      return false;
    }
    if (envelope.senderId && this.matchRoom.selfId && envelope.senderId === this.matchRoom.selfId) {
      return false;
    }

    switch (envelope.type) {
      case MatchEventType.REQUEST:
        return true;
      case MatchEventType.ACCEPT:
        if (this.matchRoom.opponentId && envelope.senderId && envelope.senderId !== this.matchRoom.opponentId) {
          this.appendLog('忽略非当前对手的 accept');
          return false;
        }
        if (envelope.payload && envelope.payload.opponentId && this.matchRoom.selfId && envelope.payload.opponentId !== this.matchRoom.selfId) {
          this.appendLog('忽略发给其他玩家的 accept');
          return false;
        }
        if (envelope.payload && envelope.payload.selfSide && !isSideValue(envelope.payload.selfSide)) {
          this.appendLog('忽略非法 side 的 accept');
          return false;
        }
        return true;
      case MatchEventType.MOVE:
      case MatchEventType.SYNC:
      case MatchEventType.ACK:
      case MatchEventType.HEARTBEAT:
      case MatchEventType.DRAW_OFFER:
      case MatchEventType.DRAW_RESPONSE:
      case MatchEventType.RESIGN:
      case MatchEventType.ERROR:
        if (!this.isKnownOpponentEnvelope(envelope)) {
          this.appendLog(`忽略非当前对手消息：${envelope.type}`);
          return false;
        }
        return true;
      default:
        return true;
    }
  },

  commitMove(move, message = '已落子') {
    if (!move) return;
    if (!this.canActOnBoard()) return;
    if (this.isOnlineMode()) {
      const blockedReason = this.getLocalTurnBlockReason();
      if (blockedReason) {
        this.appendLog(blockedReason);
        return;
      }
      if (!legalMoveExists(this.data.board, this.matchRoom.selfSide, move)) {
        this.appendLog('已拦截非法本地走子');
        return;
      }
    }

    this.boardHistory.push(cloneBoard(this.data.board));
    const nextBoard = advanceGame(this.data.board, move);
    this.setData({
      board: nextBoard,
      selectedPieceId: null,
      legalMoves: [],
      hintMove: null,
      hintText: message,
      syncMarkers: this.extractSyncMarkers(nextBoard),
    });
    this.refreshBoard(message, [], null, this.data.syncMarkers);

    if (this.isOnlineMode()) {
      this.broadcastMove(move, nextBoard);
    }

    if (this.finishIfNeeded(nextBoard)) return;

    if (!this.isOnlineMode() && nextBoard.status === 'playing' && nextBoard.currentSide === Side.BLACK) {
      this.scheduleAiMove();
    }
  },

  broadcastMove(move, nextBoard) {
    if (!this.signalClient) return false;
    if (!this.matchRoom || !canSendMove(this.matchRoom)) {
      this.appendLog('当前房间还不能发子');
      return false;
    }
    const seq = (this.matchRoom.sequence || 0) + 1;
    this.persistMatchRoom({
      ...this.matchRoom,
      sequence: seq,
      turn: nextBoard.currentSide,
      state: nextBoard.status === 'playing' || nextBoard.status === 'check' ? MatchState.PLAYING : MatchState.FINISHED,
      snapshot: cloneBoard(nextBoard),
      moveLog: [...(this.matchRoom.moveLog || []), move],
    });
    const sent = this.signalClient.sendMove(move, { seq });
    if (sent) {
      this.appendLog(`已发送走子 #${seq}`);
      return true;
    }
    this.appendLog('走子发送失败');
    return false;
  },

  scheduleAiMove() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.aiTimer = setTimeout(() => {
      this.aiTimer = null;
      if (!this.canActOnBoard()) return;
      const move = searchBestMove(this.data.board, { side: Side.BLACK, depth: 1, timeLimitMs: 80 });
      if (!move) {
        this.setData({ hintMove: null, hintText: 'AI 无合法走法' });
        this.refreshBoard('AI 无合法走法');
        return;
      }
      this.commitMove(move, 'AI 已落子');
    }, 180);
  },

  resetGame() {
    if (this.aiTimer) clearTimeout(this.aiTimer);
    this.boardHistory = [];
    const board = createInitialBoard();
    this.setData({
      board,
      selectedPieceId: null,
      legalMoves: [],
      hintMove: null,
      hintText: '点击“提示”获取推荐走法',
      syncMarkers: [],
    });
    if (this.matchRoom) {
      this.persistMatchRoom({
        ...this.matchRoom,
        state: this.isOnlineMode() ? MatchState.READY : MatchState.IDLE,
        turn: Side.RED,
        sequence: 0,
        result: null,
        snapshot: null,
        moveLog: [],
      });
    }
    this.refreshBoard('对局已重开');
  },

  startGame() {
    this.resetGame();
  },

  undoMove() {
    if (!this.boardHistory || !this.boardHistory.length) return;
    if (this.aiTimer) clearTimeout(this.aiTimer);

    const stepsToUndo = !this.isOnlineMode() && this.data.board.currentSide === Side.BLACK ? 2 : 1;
    let previous = null;
    for (let i = 0; i < stepsToUndo; i += 1) {
      if (!this.boardHistory.length) break;
      previous = this.boardHistory.pop();
    }
    if (!previous) return;

    const board = cloneBoard(previous);
    this.setData({
      board,
      selectedPieceId: null,
      legalMoves: [],
      hintMove: null,
      hintText: stepsToUndo === 2 ? '已悔棋两步，轮到你重新落子' : '已悔棋一步',
      syncMarkers: this.extractSyncMarkers(board),
    });

    if (this.isOnlineMode()) {
      this.persistMatchRoom({
        ...this.matchRoom,
        state: MatchState.SYNCHRONIZING,
        turn: board.currentSide,
        sequence: board.moveHistory.length,
        snapshot: cloneBoard(board),
      });
      if (this.signalClient) {
        this.signalClient.sendSync(cloneBoard(board), board.currentSide, board.moveHistory.length);
      }
    }

    this.refreshBoard(stepsToUndo === 2 ? '已悔棋两步' : '已悔棋一步', [], null, this.data.syncMarkers);
  },

  showHint() {
    if (!this.canActOnBoard()) {
      this.setData({ hintMove: null, hintText: '对局已结束，无法提示' });
      this.refreshBoard('对局已结束');
      return;
    }
    const blockedReason = this.getLocalTurnBlockReason();
    if (blockedReason) {
      this.setData({ hintMove: null, hintText: blockedReason });
      this.refreshBoard(blockedReason);
      return;
    }

    const side = this.data.board.currentSide;
    const hintMove = searchBestMove(this.data.board, { side, depth: 2, timeLimitMs: 60 });
    if (!hintMove) {
      this.setData({ hintMove: null, hintText: '当前没有可用提示' });
      this.refreshBoard('当前没有可用提示');
      return;
    }

    const piece = getPieceAt(this.data.board, hintMove.from.x, hintMove.from.y);
    const hintText = `${piece ? pieceLabel(piece) : '棋子'} 建议走 ${formatCoord(hintMove.from)} → ${formatCoord(hintMove.to)}`;
    const selectedLegalMoves = getLegalMoves(this.data.board, side).filter((move) => move.pieceId === hintMove.pieceId);
    this.setData({
      hintMove,
      hintText,
      selectedPieceId: piece ? piece.id : null,
      legalMoves: selectedLegalMoves,
    });
    this.refreshBoard('已给出提示', selectedLegalMoves, hintMove, this.data.syncMarkers);
  },

  onCellTap(e) {
    if (!this.canActOnBoard()) return;
    const blockedReason = this.getLocalTurnBlockReason();
    if (blockedReason) {
      this.setData({ selectedPieceId: null, legalMoves: [], hintMove: null, hintText: blockedReason });
      this.refreshBoard(blockedReason, [], null, this.data.syncMarkers);
      return;
    }

    const x = Number(e.currentTarget.dataset.x);
    const y = Number(e.currentTarget.dataset.y);
    const piece = getPieceAt(this.data.board, x, y);
    const selectedPieceId = this.data.selectedPieceId;
    const selectedMoves = this.data.legalMoves || [];
    const legalMove = selectedMoves.find((move) => move.to.x === x && move.to.y === y);

    if (legalMove) {
      this.commitMove(legalMove, '你走了一步');
      return;
    }

    if (piece && piece.side === this.data.board.currentSide) {
      const moves = getLegalMoves(this.data.board, this.data.board.currentSide).filter((move) => move.pieceId === piece.id);
      this.setData({
        selectedPieceId: piece.id,
        legalMoves: moves,
        hintMove: null,
        hintText: `已选中 ${pieceLabel(piece)}，可落点已高亮`,
      });
      this.refreshBoard(`${pieceLabel(piece)}已选中`, moves, null, this.data.syncMarkers);
      return;
    }

    if (selectedPieceId) {
      this.setData({ selectedPieceId: null, legalMoves: [], hintMove: null, hintText: '已取消选中' });
      this.refreshBoard('取消选中', [], null, this.data.syncMarkers);
    }
  },

  connectSignal() {
    const url = (this.data.signalUrl || '').trim();
    if (!url) {
      this.appendLog('请先填写信令地址');
      return;
    }
    saveSignalUrl(url);
    const ok = this.signalClient.connect(url);
    if (ok) this.appendLog(`连接中：${url}`);
  },

  disconnectSignal() {
    if (this.signalClient) this.signalClient.disconnect();
    this.appendLog('已断开信令连接');
  },

  onSignalUrlInput(e) {
    const signalUrl = e.detail.value || '';
    this.setData({ signalUrl });
    saveSignalUrl(signalUrl);
    if (this.signalClient) {
      this.signalClient.setHandlers({
        roomChange: (room, envelope) => this.onRoomChange(room, envelope),
        transportChange: (transport) => this.onTransportChange(transport),
        envelope: (envelope) => this.handleSignalEnvelope(envelope),
        error: (error) => this.appendLog(`错误：${error.code || 'UNKNOWN'} ${error.message || ''}`.trim()),
      });
    }
  },

  onRoomInput(e) {
    this.setData({ roomInputValue: normalizeRoomId(e.detail.value || '') });
  },

  createOnlineRoom() {
    const roomId = generateRoomId();
    const room = createMatchRoom({
      roomId,
      selfId: this.matchRoom && this.matchRoom.selfId ? this.matchRoom.selfId : generatePlayerId(),
      selfSide: Side.RED,
      mode: MatchMode.ONLINE,
      state: MatchState.MATCHING,
      turn: Side.RED,
    });
    this.persistMatchRoom(room);
    this.setData({ syncMarkers: [], roomInputValue: roomId });
    this.appendLog(`已创建房间 ${roomId}`);
    this.refreshBoard(`已创建房间 ${roomId}，等待对手加入`);
    if (this.signalClient && this.data.transportStatus === TransportStatus.OPEN) {
      this.signalClient.sendMatchRequest(room.selfSide, room.seed);
      this.appendLog('已向信令服务发送建房请求');
    }
  },

  joinOnlineRoom() {
    const roomId = normalizeRoomId(this.data.roomInputValue);
    if (!roomId) {
      this.appendLog('请输入房间号');
      this.refreshBoard('请输入房间号');
      return;
    }
    const room = createMatchRoom({
      roomId,
      selfId: this.matchRoom && this.matchRoom.selfId ? this.matchRoom.selfId : generatePlayerId(),
      selfSide: Side.BLACK,
      mode: MatchMode.ONLINE,
      state: MatchState.MATCHING,
      turn: Side.RED,
    });
    this.persistMatchRoom(room);
    this.setData({ syncMarkers: [], roomInputValue: roomId });
    this.appendLog(`已加入房间 ${roomId}，等待房主确认`);
    this.refreshBoard(`已加入房间 ${roomId}，等待房主确认并分配先后手`);
    if (this.signalClient && this.data.transportStatus === TransportStatus.OPEN) {
      this.signalClient.sendMatchRequest(room.selfSide, room.seed);
      this.appendLog('已向信令服务发送入房请求');
    }
  },

  copyRoomId() {
    const roomId = this.matchRoom && this.matchRoom.roomId;
    if (!roomId) {
      this.appendLog('当前没有房间号可复制');
      return;
    }
    if (typeof wx !== 'undefined' && typeof wx.setClipboardData === 'function') {
      wx.setClipboardData({ data: roomId });
    }
    this.appendLog(`已复制房间号 ${roomId}`);
  },

  sendRawEnvelope(sent) {
    if (!sent) {
      this.appendLog('发送失败');
      return false;
    }
    this.appendLog('已发送信令消息');
    return true;
  },

  sendQuickHeartbeat() {
    this.sendRawEnvelope(this.signalClient.sendHeartbeat());
  },

  sendQuickSync() {
    this.sendRawEnvelope(this.signalClient.sendSync(cloneBoard(this.data.board), this.data.board.currentSide, this.data.board.moveHistory.length));
  },

  sendQuickAck() {
    this.sendRawEnvelope(this.signalClient.sendAck(this.matchRoom.sequence || 0));
  },

  sendQuickDrawOffer() {
    this.sendRawEnvelope(this.signalClient.sendDrawOffer());
  },

  sendQuickDrawResponse() {
    this.sendRawEnvelope(this.signalClient.sendDrawResponse(true));
  },

  sendQuickResign() {
    this.sendRawEnvelope(this.signalClient.sendResign());
  },

  sendQuickError() {
    this.sendRawEnvelope(this.signalClient.sendError('NETWORK_ERROR', 'demo error'));
  },

  handleSignalEnvelope(envelope) {
    if (!envelope || !envelope.type) return;
    if (!this.shouldAcceptEnvelope(envelope)) {
      return;
    }

    this.appendLog(`收到 ${envelope.type}`);

    switch (envelope.type) {
      case MatchEventType.REQUEST:
        if (this.matchRoom && this.matchRoom.state === MatchState.MATCHING) {
          const acceptPayload = createAcceptPayload(this.matchRoom, envelope);
          this.persistMatchRoom({
            ...this.matchRoom,
            roomId: acceptPayload.roomId,
            opponentId: acceptPayload.opponentId,
            selfSide: acceptPayload.selfSide,
            opponentSide: oppositeSide(acceptPayload.selfSide),
            state: MatchState.PLAYING,
            turn: Side.RED,
            seed: acceptPayload.seed,
          });
          if (this.signalClient && this.data.transportStatus === TransportStatus.OPEN) {
            this.sendRawEnvelope(this.signalClient.sendMatchAccept(
              acceptPayload.opponentId,
              acceptPayload.selfSide,
              acceptPayload.seed,
            ));
          }
          this.appendLog(`匹配成功：你执${acceptPayload.selfSide === Side.RED ? '红' : '黑'}，对手先后手已确认`);
          this.refreshBoard(`匹配成功，你执${acceptPayload.selfSide === Side.RED ? '红方' : '黑方'}，${Side.RED === acceptPayload.selfSide ? '你先手' : '对手先手'}`);
        }
        break;
      case MatchEventType.ACCEPT: {
        const assignedSide = envelope.payload && isSideValue(envelope.payload.selfSide)
          ? envelope.payload.selfSide
          : this.matchRoom.selfSide;
        const mySide = oppositeSide(assignedSide);
        this.persistMatchRoom({
          ...this.matchRoom,
          roomId: envelope.roomId || this.matchRoom.roomId,
          opponentId: envelope.senderId || this.matchRoom.opponentId,
          selfSide: mySide,
          opponentSide: assignedSide,
          state: MatchState.PLAYING,
          turn: Side.RED,
          seed: envelope.payload ? envelope.payload.seed : this.matchRoom.seed,
        });
        this.appendLog(`匹配成功，当前你执${mySide === Side.RED ? '红' : '黑'}`);
        this.refreshBoard(`匹配成功，你执${mySide === Side.RED ? '红方' : '黑方'}，${mySide === Side.RED ? '你先手' : '对手先手'}`);
        break;
      }
      case MatchEventType.MOVE:
        if (envelope.payload && envelope.payload.move) {
          this.applyRemoteMove(envelope.payload.move, envelope.seq);
        }
        break;
      case MatchEventType.SYNC:
        break;
      case MatchEventType.ACK:
        this.appendLog(`收到 ACK #${envelope.payload && envelope.payload.ackSeq ? envelope.payload.ackSeq : 0}`);
        break;
      case MatchEventType.HEARTBEAT:
        break;
      case MatchEventType.DRAW_OFFER:
        this.appendLog('对手提和');
        break;
      case MatchEventType.DRAW_RESPONSE:
        if (envelope.payload && envelope.payload.accepted) {
          this.appendLog('对手同意平局');
          this.finishAsDraw();
        }
        break;
      case MatchEventType.RESIGN:
        this.appendLog('对手认输');
        if (this.data.board.status === 'playing' || this.data.board.status === 'check') {
          const resignedBy = envelope.senderId && this.matchRoom && envelope.senderId === this.matchRoom.selfId
            ? this.matchRoom.selfSide
            : this.matchRoom.opponentSide;
          this.finishAsWin(resignedBy === Side.RED ? Side.BLACK : Side.RED, 'resign');
        }
        break;
      case MatchEventType.ERROR:
        break;
      default:
        break;
    }
  },

  finishAsDraw() {
    const board = { ...this.data.board, status: 'draw', winner: null };
    this.saveMatchResult(board);
    this.persistMatchRoom({
      ...this.matchRoom,
      state: MatchState.FINISHED,
      result: { winner: null, reason: 'draw' },
      snapshot: cloneBoard(board),
    });
    wx.reLaunch({ url: '/pages/result/result?status=draw&winner=' });
  },

  finishAsWin(winner, reason = 'resign') {
    const board = { ...this.data.board, status: 'checkmate', winner };
    this.saveMatchResult(board);
    this.persistMatchRoom({
      ...this.matchRoom,
      state: MatchState.FINISHED,
      result: { winner, reason },
      snapshot: cloneBoard(board),
    });
    wx.reLaunch({ url: `/pages/result/result?status=checkmate&winner=${winner || ''}` });
  },

  syncBoardFromRoom(boardSnapshot, turn, moveSeq, moveLog = null) {
    const options = arguments[4] || {};
    const incomingSeq = typeof moveSeq === 'number' ? moveSeq : null;
    const currentSeq = getMoveSequence(this.data.board);
    if (!options.allowOlder && incomingSeq !== null && incomingSeq < currentSeq) {
      this.appendLog(`忽略过期同步 #${incomingSeq}`);
      return;
    }

    const replayed = safeReplayBoard(boardSnapshot, moveLog);
    const nextBoard = cloneBoard(replayed.board);
    const replaySide = normalizeTurn(nextBoard.currentSide, Side.RED);
    const incomingTurn = isSideValue(turn) ? turn : null;
    if (incomingTurn && incomingTurn !== replaySide) {
      this.appendLog(`同步回合不一致，已采用棋盘推导回合：${replaySide}`);
    }
    nextBoard.currentSide = incomingTurn && incomingTurn === replaySide ? incomingTurn : replaySide;
    if (incomingSeq !== null) {
      nextBoard.moveHistory = nextBoard.moveHistory.slice(0, moveSeq);
    }
    const lastHistoryMove = nextBoard.moveHistory[nextBoard.moveHistory.length - 1] || null;
    if (!sameMove(nextBoard.lastMove, lastHistoryMove)) nextBoard.lastMove = cloneMove(lastHistoryMove);
    this.boardHistory = [];
    this.setData({
      board: nextBoard,
      selectedPieceId: null,
      legalMoves: [],
      hintMove: null,
      hintText: options.reason === 'restore' ? '已恢复上次在线局面' : '已同步房间局面',
      syncMarkers: this.extractSyncMarkers(nextBoard),
    });
    if (this.matchRoom) {
      const nextState = this.matchRoom.state === MatchState.FINISHED
        ? MatchState.FINISHED
        : this.canActOnBoardFor(nextBoard)
          ? MatchState.PLAYING
          : MatchState.FINISHED;
      const nextMoveLog = Array.isArray(moveLog)
        ? replayed.history
        : Array.isArray(nextBoard.moveHistory)
          ? nextBoard.moveHistory.map(cloneMove)
          : [];
      this.persistMatchRoom({
        ...this.matchRoom,
        state: nextState,
        turn: nextBoard.currentSide,
        sequence: incomingSeq !== null ? incomingSeq : replayed.history.length || this.matchRoom.sequence,
        lastError: null,
        snapshot: cloneBoard(nextBoard),
        moveLog: nextMoveLog,
      });
    }
    if (replayed.error) {
      this.appendLog('同步 moveLog 回放失败，已回退到 snapshot');
    }
    this.refreshBoard(options.reason === 'restore' ? '已恢复在线局面' : '收到同步局面', undefined, undefined, this.data.syncMarkers);
  },

  applyRemoteMove(move, seq) {
    if (!move || !move.from || !move.to) return;
    if (!this.matchRoom || this.matchRoom.state !== MatchState.PLAYING) {
      this.appendLog('忽略非对局状态下的远端走子');
      return;
    }
    const opponentSide = this.getExpectedOpponentSide();
    const currentSeq = getMoveSequence(this.data.board);
    if (!isSideValue(opponentSide)) {
      this.appendLog('忽略缺少对手 side 的远端走子');
      return;
    }
    if (typeof seq === 'number' && seq <= currentSeq) {
      this.appendLog(`忽略重复走子 #${seq}`);
      return;
    }
    if (typeof seq === 'number' && seq !== currentSeq + 1) {
      this.appendLog(`远端走子序号异常 #${seq}，当前应为 #${currentSeq + 1}`);
      if (this.signalClient) {
        this.signalClient.sendSync(cloneBoard(this.data.board), this.data.board.currentSide, currentSeq);
      }
      return;
    }
    if (this.matchRoom.turn !== opponentSide) {
      this.appendLog('忽略非对手回合的远端走子');
      return;
    }
    if (this.data.board.currentSide !== opponentSide) {
      this.appendLog('忽略错误回合的远端走子');
      return;
    }
    if (!legalMoveExists(this.data.board, opponentSide, move)) {
      this.appendLog('远端走子非法，已请求重新同步');
      if (this.signalClient && this.matchRoom.snapshot) {
        this.signalClient.sendSync(cloneBoard(this.data.board), this.data.board.currentSide, getMoveSequence(this.data.board));
      }
      return;
    }
    const nextBoard = advanceGame(this.data.board, move);
    this.boardHistory.push(cloneBoard(this.data.board));
    this.setData({
      board: nextBoard,
      selectedPieceId: null,
      legalMoves: [],
      hintMove: null,
      hintText: '对手已落子',
      syncMarkers: this.extractSyncMarkers(nextBoard),
    });
    if (this.matchRoom) {
      const nextMoveLog = Array.isArray(nextBoard.moveHistory)
        ? nextBoard.moveHistory.map(cloneMove)
        : [...(this.matchRoom.moveLog || []), cloneMove(move)];
      this.persistMatchRoom({
        ...this.matchRoom,
        state: nextBoard.status === 'playing' || nextBoard.status === 'check' ? MatchState.PLAYING : MatchState.FINISHED,
        turn: nextBoard.currentSide,
        sequence: typeof seq === 'number' ? seq : nextBoard.moveHistory.length,
        snapshot: cloneBoard(nextBoard),
        moveLog: nextMoveLog,
      });
    }
    this.refreshBoard(`收到对手走子${seq ? ` #${seq}` : ''}`, undefined, undefined, this.data.syncMarkers);
    if (this.finishIfNeeded(nextBoard)) return;
  },

  extractSyncMarkers(board) {
    if (!board || !board.lastMove) return [];
    return [board.lastMove.from, board.lastMove.to];
  },

  canActOnBoardFor(board) {
    return board && (board.status === 'playing' || board.status === 'check');
  },

  resetMatchRoom() {
    const room = createMatchRoom({
      roomId: generateRoomId(),
      selfId: this.matchRoom && this.matchRoom.selfId ? this.matchRoom.selfId : generatePlayerId(),
      selfSide: Side.RED,
      mode: MatchMode.ONLINE,
      state: MatchState.IDLE,
    });
    this.persistMatchRoom(room);
    this.setData({ syncMarkers: [], roomInputValue: room.roomId });
    this.appendLog('在线房间已重置');
    this.refreshBoard('在线房间已重置');
  },

  simulateIncomingRequest() {
    const envelope = {
      v: '1.0',
      type: MatchEventType.REQUEST,
      roomId: this.matchRoom.roomId || 'room-demo-001',
      senderId: 'remote-black',
      seq: 1,
      ts: Date.now(),
      payload: { desiredSide: Side.BLACK, seed: 7 },
    };
    this.signalClient.applyIncomingEnvelope(envelope);
    this.appendLog('模拟收到 request');
  },

  simulateIncomingAccept() {
    const envelope = {
      v: '1.0',
      type: MatchEventType.ACCEPT,
      roomId: this.matchRoom.roomId || 'room-demo-001',
      senderId: 'remote-black',
      seq: 2,
      ts: Date.now(),
      payload: { opponentId: 'remote-black', selfSide: Side.RED, seed: 7 },
    };
    this.signalClient.applyIncomingEnvelope(envelope);
    this.appendLog('模拟收到 accept');
  },

  simulateIncomingMove() {
    const envelope = {
      v: '1.0',
      type: MatchEventType.MOVE,
      roomId: this.matchRoom.roomId || 'room-demo-001',
      senderId: 'remote-black',
      seq: 3,
      ts: Date.now(),
      payload: { move: { pieceId: 'b-r1', from: { x: 0, y: 0 }, to: { x: 0, y: 1 } } },
    };
    this.signalClient.applyIncomingEnvelope(envelope);
    this.appendLog('模拟收到 move');
  },

  simulateIncomingSync() {
    const envelope = {
      v: '1.0',
      type: MatchEventType.SYNC,
      roomId: this.matchRoom.roomId || 'room-demo-001',
      senderId: 'remote-black',
      seq: 4,
      ts: Date.now(),
      payload: { board: cloneBoard(this.data.board), turn: this.data.board.currentSide, moveSeq: this.data.board.moveHistory.length },
    };
    this.signalClient.applyIncomingEnvelope(envelope);
    this.appendLog('模拟收到 sync');
  },

  simulateIncomingHeartbeat() {
    this.signalClient.applyIncomingEnvelope({
      v: '1.0',
      type: MatchEventType.HEARTBEAT,
      roomId: this.matchRoom.roomId || 'room-demo-001',
      senderId: 'remote-black',
      seq: 5,
      ts: Date.now(),
      payload: { ping: Date.now() },
    });
    this.appendLog('模拟收到 heartbeat');
  },

  simulateIncomingDrawOffer() {
    this.signalClient.applyIncomingEnvelope({
      v: '1.0',
      type: MatchEventType.DRAW_OFFER,
      roomId: this.matchRoom.roomId || 'room-demo-001',
      senderId: 'remote-black',
      seq: 6,
      ts: Date.now(),
      payload: {},
    });
    this.appendLog('模拟收到 draw.offer');
  },

  simulateIncomingDrawAccept() {
    this.signalClient.applyIncomingEnvelope({
      v: '1.0',
      type: MatchEventType.DRAW_RESPONSE,
      roomId: this.matchRoom.roomId || 'room-demo-001',
      senderId: 'remote-black',
      seq: 6,
      ts: Date.now(),
      payload: { accepted: true },
    });
    this.appendLog('模拟收到 draw.response');
  },

  simulateIncomingResign() {
    this.signalClient.applyIncomingEnvelope({
      v: '1.0',
      type: MatchEventType.RESIGN,
      roomId: this.matchRoom.roomId || 'room-demo-001',
      senderId: 'remote-black',
      seq: 7,
      ts: Date.now(),
      payload: {},
    });
    this.appendLog('模拟收到 resign');
  },

  simulateIncomingError() {
    this.signalClient.applyIncomingEnvelope({
      v: '1.0',
      type: MatchEventType.ERROR,
      roomId: this.matchRoom.roomId || 'room-demo-001',
      senderId: 'remote-black',
      seq: 8,
      ts: Date.now(),
      payload: { code: 'NETWORK_ERROR', message: 'mock offline' },
    });
    this.appendLog('模拟收到 error');
  },

  simulateOnlineRequest() {
    this.simulateIncomingRequest();
  },

  simulateOnlineAccept() {
    this.simulateIncomingAccept();
  },

  simulateOnlineSync() {
    this.simulateIncomingSync();
  },

  simulateOnlineHeartbeat() {
    this.simulateIncomingHeartbeat();
  },

  simulateOnlineDrawOffer() {
    this.simulateIncomingDrawOffer();
  },

  simulateOnlineDrawAccept() {
    this.simulateIncomingDrawAccept();
  },

  simulateOnlineResign() {
    this.simulateIncomingResign();
  },

  simulateOnlineError() {
    this.simulateIncomingError();
  },

  goResult() {
    wx.navigateTo({ url: '/pages/result/result' });
  },
});
