const { createGameState } = require('../../utils/game-state');
const {
  Side,
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
      transportStatus: this.signalClient.getTransportState().status,
      connectionStatus: this.describeConnection(this.matchRoom, this.signalClient.getTransportState().status),
    });

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
    this.setData({ matchRoom: room, connectionStatus: this.describeConnection(room, this.data.transportStatus) });
  },

  onTransportChange(transport) {
    this.setData({
      transportStatus: transport.status,
      connectionStatus: this.describeConnection(this.matchRoom, transport.status),
    });
    if (transport.lastError) {
      this.appendLog(`信令状态：${transport.lastError.code || 'ERROR'}`);
    }
  },

  onRoomChange(room, envelope) {
    this.persistMatchRoom(room);
    if (envelope) {
      this.appendLog(`房间更新：${envelope.type}`);
    }
    if (room.snapshot && room.state === MatchState.SYNCHRONIZING) {
      this.syncBoardFromRoom(room.snapshot, room.turn, room.sequence);
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

  isOnlineMode() {
    return this.matchRoom && this.matchRoom.mode === MatchMode.ONLINE;
  },

  isMyTurn() {
    if (!this.isOnlineMode()) return true;
    return this.matchRoom.state === MatchState.PLAYING && this.matchRoom.turn === this.matchRoom.selfSide;
  },

  commitMove(move, message = '已落子') {
    if (!move) return;
    if (!this.canActOnBoard()) return;
    if (this.isOnlineMode()) {
      if (this.matchRoom.state !== MatchState.PLAYING) {
        this.appendLog('当前房间还没有进入对局');
        return;
      }
      if (this.matchRoom.turn !== this.matchRoom.selfSide) {
        this.appendLog('还没轮到你');
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
    if (this.isOnlineMode() && !this.isMyTurn()) {
      this.setData({ hintMove: null, hintText: '当前不是你的回合' });
      this.refreshBoard('当前不是你的回合');
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
    if (this.isOnlineMode() && !this.isMyTurn()) return;

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
        onRoomChange: (room, envelope) => this.onRoomChange(room, envelope),
        onTransportChange: (transport) => this.onTransportChange(transport),
        onEnvelope: (envelope) => this.handleSignalEnvelope(envelope),
        onError: (error) => this.appendLog(`错误：${error.code || 'UNKNOWN'} ${error.message || ''}`.trim()),
      });
    }
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
    if (envelope.roomId && this.matchRoom && this.matchRoom.roomId && envelope.roomId !== this.matchRoom.roomId) {
      this.appendLog(`忽略其他房间消息：${envelope.type}`);
      return;
    }
    if (this.matchRoom && envelope.senderId && this.matchRoom.selfId && envelope.senderId === this.matchRoom.selfId) {
      return;
    }

    this.appendLog(`收到 ${envelope.type}`);

    switch (envelope.type) {
      case MatchEventType.REQUEST: {
        const nextRoom = applyMatchEvent(this.matchRoom, envelope);
        this.persistMatchRoom(nextRoom);
        break;
      }
      case MatchEventType.ACCEPT: {
        const nextRoom = applyMatchEvent(this.matchRoom, envelope);
        this.persistMatchRoom(nextRoom);
        if (envelope.payload && envelope.payload.board) {
          this.syncBoardFromRoom(envelope.payload.board, envelope.payload.selfSide || this.matchRoom.selfSide, envelope.payload.moveSeq, envelope.payload.moveLog);
        } else {
          this.appendLog('匹配成功，等待同步局面');
        }
        break;
      }
      case MatchEventType.MOVE:
        if (envelope.payload && envelope.payload.move) {
          this.applyRemoteMove(envelope.payload.move, envelope.seq);
        }
        break;
      case MatchEventType.SYNC:
        if (envelope.payload && envelope.payload.board) {
          this.syncBoardFromRoom(envelope.payload.board, envelope.payload.turn, envelope.payload.moveSeq, envelope.payload.moveLog);
        }
        break;
      case MatchEventType.ACK: {
        const nextRoom = applyMatchEvent(this.matchRoom, envelope);
        this.persistMatchRoom(nextRoom);
        this.appendLog(`收到 ACK #${envelope.payload && envelope.payload.ackSeq ? envelope.payload.ackSeq : 0}`);
        break;
      }
      case MatchEventType.HEARTBEAT: {
        const nextRoom = applyMatchEvent(this.matchRoom, envelope);
        this.persistMatchRoom(nextRoom);
        break;
      }
      case MatchEventType.DRAW_OFFER: {
        const nextRoom = applyMatchEvent(this.matchRoom, envelope);
        this.persistMatchRoom(nextRoom);
        this.appendLog('对手提和');
        break;
      }
      case MatchEventType.DRAW_RESPONSE: {
        const nextRoom = applyMatchEvent(this.matchRoom, envelope);
        this.persistMatchRoom(nextRoom);
        if (envelope.payload && envelope.payload.accepted) {
          this.appendLog('对手同意平局');
          this.finishAsDraw();
        }
        break;
      }
      case MatchEventType.RESIGN: {
        const nextRoom = applyMatchEvent(this.matchRoom, envelope);
        this.persistMatchRoom(nextRoom);
        this.appendLog('对手认输');
        if (this.data.board.status === 'playing' || this.data.board.status === 'check') {
          const resignedBy = envelope.senderId && this.matchRoom && envelope.senderId === this.matchRoom.selfId
            ? this.matchRoom.selfSide
            : this.matchRoom.opponentSide;
          this.finishAsWin(resignedBy === Side.RED ? Side.BLACK : Side.RED, 'resign');
        }
        break;
      }
      case MatchEventType.ERROR: {
        const nextRoom = applyMatchEvent(this.matchRoom, envelope);
        this.persistMatchRoom(nextRoom);
        break;
      }
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
    const boardSource = boardSnapshot && boardSnapshot.pieces ? boardSnapshot : createInitialBoard();
    const history = Array.isArray(moveLog) && moveLog.length ? moveLog.filter(Boolean).map(cloneMove) : [];
    const replayed = history.length ? replayMoves(createInitialBoard(), history) : cloneBoard(boardSource);
    const nextBoard = cloneBoard(replayed);
    if (turn) nextBoard.currentSide = turn;
    if (typeof moveSeq === 'number') {
      nextBoard.moveHistory = nextBoard.moveHistory.slice(0, moveSeq);
    }
    this.boardHistory = [];
    this.setData({
      board: nextBoard,
      selectedPieceId: null,
      legalMoves: [],
      hintMove: null,
      hintText: '已同步房间局面',
      syncMarkers: this.extractSyncMarkers(nextBoard),
    });
    if (this.matchRoom) {
      this.persistMatchRoom({
        ...this.matchRoom,
        state: MatchState.PLAYING,
        turn: nextBoard.currentSide,
        sequence: typeof moveSeq === 'number' ? moveSeq : history.length || this.matchRoom.sequence,
        lastError: null,
        snapshot: cloneBoard(nextBoard),
        moveLog: history.length ? history : [...(this.matchRoom.moveLog || [])],
      });
    }
    this.refreshBoard('收到同步局面', undefined, undefined, this.data.syncMarkers);
  },

  applyRemoteMove(move, seq) {
    if (!move || !move.from || !move.to) return;
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
      this.persistMatchRoom({
        ...this.matchRoom,
        state: nextBoard.status === 'playing' || nextBoard.status === 'check' ? MatchState.PLAYING : MatchState.FINISHED,
        turn: nextBoard.currentSide,
        sequence: Math.max(this.matchRoom.sequence || 0, seq || 0),
        snapshot: cloneBoard(nextBoard),
      });
    }
    this.refreshBoard(`收到对手走子${seq ? ` #${seq}` : ''}`, undefined, undefined, this.data.syncMarkers);
    if (this.finishIfNeeded(nextBoard)) return;
  },

  extractSyncMarkers(board) {
    if (!board || !board.lastMove) return [];
    return [board.lastMove.from, board.lastMove.to];
  },

  resetMatchRoom() {
    const room = createMatchRoom({
      roomId: 'room-demo-001',
      selfId: 'local-red',
      selfSide: Side.RED,
      mode: MatchMode.ONLINE,
      state: MatchState.IDLE,
    });
    this.persistMatchRoom(room);
    this.setData({ syncMarkers: [] });
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
